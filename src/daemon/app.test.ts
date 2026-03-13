import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	cleanupDaemonTestHarnesses,
	createDaemonTestHarness,
	dispatchDaemonRequest,
	readDaemonJson,
	reopenDaemonTestHarness,
	seedActiveStepRun,
} from "./test-helpers.ts";
import { makeWorkflow } from "../workflows/test-fixtures.ts";

afterEach(async () => {
	await cleanupDaemonTestHarnesses();
});

describe("daemon app", () => {
	test("POST /runs creates and auto-starts a persisted run", async () => {
		const dispatchedRunIds: string[] = [];
		const harness = await createDaemonTestHarness({
			dispatchRun: ({ runId }) => {
				dispatchedRunIds.push(runId);
			},
		});

		const response = await dispatchDaemonRequest(harness.app, "POST", "/runs", {
			workflowId: "cross-repo-bugfix",
			configRoot: harness.configRoot,
			repoBindings: harness.repoBindings,
		});

		expect(response.status).toBe(201);
		expect(await expectJson(response)).toMatchObject({
			ok: true,
			run: {
				runId: "run-001",
				status: "running",
				currentStepId: null,
				latestEventSequence: 2,
				launch: expect.objectContaining({
					workflow: expect.objectContaining({
						workflowId: "cross-repo-bugfix",
					}),
				}),
			},
		});
		expect(harness.store.readRun("run-001")).toMatchObject({
			status: "running",
			latestEventSequence: 2,
		});
		expect(dispatchedRunIds).toEqual(["run-001"]);
	});

	test("POST /runs uses the stock local dispatch path without Inngest event credentials", async () => {
		const harness = await createDaemonTestHarness({
			useAppDefaultDispatch: true,
		});
		await Bun.write(
			join(harness.configRoot, "workflows", "cross-repo-bugfix.json"),
			`${JSON.stringify(
				makeWorkflow({
					nodes: makeWorkflow().nodes.map((node) =>
						node.id === "typecheck"
							? {
									...node,
									settings: {
										...node.settings,
										command: "printf 'shell-ok\\n'",
									},
								}
							: node,
					),
				}),
				null,
				2,
			)}\n`,
		);

		const response = await dispatchDaemonRequest(harness.app, "POST", "/runs", {
			workflowId: "cross-repo-bugfix",
			configRoot: harness.configRoot,
			repoBindings: harness.repoBindings,
		});

		expect(response.status).toBe(201);
		expect(await expectJson(response)).toMatchObject({
			ok: true,
			run: expect.objectContaining({
				runId: "run-001",
				status: "running",
			}),
		});

		await waitFor(
			() => harness.store.readRun("run-001")?.status === "completed",
		);
		expect(harness.store.readRun("run-001")).toMatchObject({
			runId: "run-001",
			status: "completed",
		});
	});

	test("POST /runs fails the run closed when runtime dispatch throws", async () => {
		const harness = await createDaemonTestHarness({
			dispatchRun: () => {
				throw new Error("dispatch offline");
			},
		});

		const response = await dispatchDaemonRequest(harness.app, "POST", "/runs", {
			workflowId: "cross-repo-bugfix",
			configRoot: harness.configRoot,
			repoBindings: harness.repoBindings,
		});

		expect(response.status).toBe(500);
		expect(await expectJson(response)).toMatchObject({
			ok: false,
			error: {
				code: "runtime_dispatch_failed",
				message:
					'Persisted run "run-001" could not be dispatched to the runtime.',
				runId: "run-001",
			},
		});
		expect(harness.store.readRun("run-001")).toMatchObject({
			runId: "run-001",
			status: "failed",
			failureMessage:
				'Persisted run "run-001" could not be dispatched to the runtime.',
			latestEventSequence: 3,
		});
	});

	test("POST /runs returns launch validation failures with stable JSON", async () => {
		const harness = await createDaemonTestHarness();

		const response = await dispatchDaemonRequest(harness.app, "POST", "/runs", {
			workflowId: "cross-repo-bugfix",
			configRoot: harness.configRoot,
			repoBindings: {
				"agent-console": harness.repoBindings["agent-console"],
			},
		});

		expect(response.status).toBe(400);
		expect(await expectJson(response)).toMatchObject({
			ok: false,
			error: expect.objectContaining({
				code: "repo_binding_resolution_failed",
				issues: [
					expect.objectContaining({
						code: "missing_required_repo_binding",
					}),
				],
			}),
		});
	});

	test("POST /runs rejects non-JSON content types before launch mutation", async () => {
		const harness = await createDaemonTestHarness();

		const response = await harness.app.fetch(
			new Request("http://daemon.test/runs", {
				method: "POST",
				headers: {
					"content-type": "text/plain",
					origin: "https://evil.example",
				},
				body: JSON.stringify({
					workflowId: "cross-repo-bugfix",
					configRoot: harness.configRoot,
					repoBindings: harness.repoBindings,
				}),
			}),
		);

		expect(response.status).toBe(415);
		expect(await expectJson(response)).toMatchObject({
			ok: false,
			error: expect.objectContaining({
				code: "unsupported_media_type",
			}),
		});
		expect(harness.store.listRuns()).toEqual([]);
	});

	test("GET /runs returns persisted summaries from SQLite", async () => {
		const harness = await createDaemonTestHarness();

		await dispatchDaemonRequest(harness.app, "POST", "/runs", {
			workflowId: "cross-repo-bugfix",
			configRoot: harness.configRoot,
			repoBindings: harness.repoBindings,
		});

		const response = await dispatchDaemonRequest(harness.app, "GET", "/runs");

		expect(response.status).toBe(200);
		expect(await expectJson(response)).toEqual({
			ok: true,
			runs: [
				{
					runId: "run-001",
					workflowId: "cross-repo-bugfix",
					workflowName: "Cross-Repo Bugfix",
					status: "running",
					currentStepId: null,
					createdAt: "2026-03-11T12:00:00.000Z",
					updatedAt: "2026-03-11T12:00:00.000Z",
					latestEventSequence: 2,
				},
			],
		});
	});

	test("GET /api/inngest delegates to the mounted Inngest handler", async () => {
		const harness = await createDaemonTestHarness({
			inngestHandler: (request) =>
				new Response(JSON.stringify({ method: request.method }), {
					status: 202,
					headers: {
						"content-type": "application/json; charset=utf-8",
					},
				}),
		});

		const response = await dispatchDaemonRequest(
			harness.app,
			"GET",
			"/api/inngest",
		);

		expect(response.status).toBe(202);
		expect(await readDaemonJson(response)).toEqual({
			method: "GET",
		});
	});

	test("GET /runs/:id returns detail and unknown ids return 404", async () => {
		const harness = await createDaemonTestHarness();

		await dispatchDaemonRequest(harness.app, "POST", "/runs", {
			workflowId: "cross-repo-bugfix",
			configRoot: harness.configRoot,
			repoBindings: harness.repoBindings,
		});

		const found = await dispatchDaemonRequest(
			harness.app,
			"GET",
			"/runs/run-001",
		);
		expect(found.status).toBe(200);
		expect(await expectJson(found)).toMatchObject({
			ok: true,
			run: expect.objectContaining({
				runId: "run-001",
				status: "running",
			}),
		});

		const missing = await dispatchDaemonRequest(
			harness.app,
			"GET",
			"/runs/missing",
		);
		expect(missing.status).toBe(404);
		expect(await expectJson(missing)).toMatchObject({
			ok: false,
			error: expect.objectContaining({
				code: "run_store_not_found",
				runId: "missing",
			}),
		});
	});

	test("GET /runs/:id/events returns JSON 404 for unknown runs", async () => {
		const harness = await createDaemonTestHarness();

		const response = await dispatchDaemonRequest(
			harness.app,
			"GET",
			"/runs/missing/events",
		);

		expect(response.status).toBe(404);
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(await expectJson(response)).toMatchObject({
			ok: false,
			error: expect.objectContaining({
				code: "run_store_not_found",
				runId: "missing",
			}),
		});
	});

	test("GET /runs/:id/events streams live control events with SSE framing", async () => {
		const harness = await createDaemonTestHarness();

		await dispatchDaemonRequest(harness.app, "POST", "/runs", {
			workflowId: "cross-repo-bugfix",
			configRoot: harness.configRoot,
			repoBindings: harness.repoBindings,
		});

		const streamResponse = await dispatchDaemonRequest(
			harness.app,
			"GET",
			"/runs/run-001/events",
		);

		expect(streamResponse.status).toBe(200);
		expect(streamResponse.headers.get("content-type")).toContain(
			"text/event-stream",
		);
		expect(streamResponse.headers.get("cache-control")).toBe("no-cache");

		const eventPromise = readSseEvents(streamResponse, 1);

		const controlResponse = await dispatchDaemonRequest(
			harness.app,
			"POST",
			"/runs/run-001/control",
			{
				action: "cancel",
				reason: "operator stopped run",
			},
		);
		expect(controlResponse.status).toBe(200);

		await expect(eventPromise).resolves.toEqual([
			{
				id: "3",
				event: "run.cancelled",
				data: {
					runId: "run-001",
					sequence: 3,
					type: "run.cancelled",
					occurredAt: "2026-03-11T12:00:00.000Z",
					reason: "operator stopped run",
				},
			},
		]);
	});

	test("GET /runs/:id/events streams multiple sequential events in order", async () => {
		const harness = await createDaemonTestHarness();
		await seedActiveStepRun(harness, "run-stream-order");

		const streamResponse = await dispatchDaemonRequest(
			harness.app,
			"GET",
			"/runs/run-stream-order/events",
		);

		const eventsPromise = readSseEvents(streamResponse, 2);

		const requestApprovalResponse = await dispatchDaemonRequest(
			harness.app,
			"POST",
			"/runs/run-stream-order/control",
			{
				action: "request_approval",
				approvalId: "approval-010",
				stepId: "implement",
				message: "Ship it?",
			},
		);
		expect(requestApprovalResponse.status).toBe(200);

		const resolveApprovalResponse = await dispatchDaemonRequest(
			harness.app,
			"POST",
			"/runs/run-stream-order/control",
			{
				action: "resolve_approval",
				approvalId: "approval-010",
				decision: "approved",
				comment: "Looks good.",
			},
		);
		expect(resolveApprovalResponse.status).toBe(200);

		await expect(eventsPromise).resolves.toEqual([
			{
				id: "4",
				event: "approval.requested",
				data: {
					runId: "run-stream-order",
					sequence: 4,
					type: "approval.requested",
					occurredAt: "2026-03-11T12:00:00.000Z",
					approvalId: "approval-010",
					stepId: "implement",
					message: "Ship it?",
				},
			},
			{
				id: "5",
				event: "approval.resolved",
				data: {
					runId: "run-stream-order",
					sequence: 5,
					type: "approval.resolved",
					occurredAt: "2026-03-11T12:00:00.000Z",
					approvalId: "approval-010",
					decision: "approved",
					comment: "Looks good.",
				},
			},
		]);
	});

	test("GET /runs/:id/events publishes resumed runtime events after approval resolution on the stock local dispatcher", async () => {
		const harness = await createDaemonTestHarness({
			useAppDefaultDispatch: true,
		});
		await Bun.write(
			join(harness.configRoot, "workflows", "cross-repo-bugfix.json"),
			`${JSON.stringify(makeApprovalWorkflow("printf 'shell-ok\\n'"), null, 2)}\n`,
		);

		const createResponse = await dispatchDaemonRequest(
			harness.app,
			"POST",
			"/runs",
			{
				workflowId: "cross-repo-bugfix",
				configRoot: harness.configRoot,
				repoBindings: harness.repoBindings,
			},
		);
		expect(createResponse.status).toBe(201);

		await waitFor(
			() => harness.store.readRun("run-001")?.status === "waiting_for_approval",
		);

		const streamResponse = await dispatchDaemonRequest(
			harness.app,
			"GET",
			"/runs/run-001/events",
		);
		expect(streamResponse.status).toBe(200);

		const eventsPromise = readSseEvents(streamResponse, 8);

		const resolveApprovalResponse = await dispatchDaemonRequest(
			harness.app,
			"POST",
			"/runs/run-001/control",
			{
				action: "resolve_approval",
				approvalId: "approval:approve",
				decision: "approved",
			},
		);
		expect(resolveApprovalResponse.status).toBe(200);

		await expect(eventsPromise).resolves.toEqual([
			{
				id: "7",
				event: "approval.resolved",
				data: {
					runId: "run-001",
					sequence: 7,
					type: "approval.resolved",
					occurredAt: "2026-03-11T12:00:00.000Z",
					approvalId: "approval:approve",
					decision: "approved",
				},
			},
			{
				id: "8",
				event: "step.completed",
				data: {
					runId: "run-001",
					sequence: 8,
					type: "step.completed",
					occurredAt: "2026-03-11T12:00:00.000Z",
					stepId: "approve",
				},
			},
			{
				id: "9",
				event: "step.started",
				data: {
					runId: "run-001",
					sequence: 9,
					type: "step.started",
					occurredAt: "2026-03-11T12:00:00.000Z",
					stepId: "typecheck",
				},
			},
			{
				id: "10",
				event: "artifact.created",
				data: expect.objectContaining({
					runId: "run-001",
					sequence: 10,
					type: "artifact.created",
					stepId: "typecheck",
				}),
			},
			{
				id: "11",
				event: "step.completed",
				data: {
					runId: "run-001",
					sequence: 11,
					type: "step.completed",
					occurredAt: "2026-03-11T12:00:00.000Z",
					stepId: "typecheck",
				},
			},
			{
				id: "12",
				event: "step.started",
				data: {
					runId: "run-001",
					sequence: 12,
					type: "step.started",
					occurredAt: "2026-03-11T12:00:00.000Z",
					stepId: "terminal",
				},
			},
			{
				id: "13",
				event: "step.completed",
				data: {
					runId: "run-001",
					sequence: 13,
					type: "step.completed",
					occurredAt: "2026-03-11T12:00:00.000Z",
					stepId: "terminal",
				},
			},
			{
				id: "14",
				event: "run.completed",
				data: {
					runId: "run-001",
					sequence: 14,
					type: "run.completed",
					occurredAt: "2026-03-11T12:00:00.000Z",
				},
			},
		]);
	});

	test("GET /runs/:id/events replays from Last-Event-ID and continues live", async () => {
		const harness = await createDaemonTestHarness();
		await seedActiveStepRun(harness, "run-replay");

		await dispatchDaemonRequest(
			harness.app,
			"POST",
			"/runs/run-replay/control",
			{
				action: "request_approval",
				approvalId: "approval-replay",
				stepId: "implement",
				message: "Ship it?",
			},
		);
		await dispatchDaemonRequest(
			harness.app,
			"POST",
			"/runs/run-replay/control",
			{
				action: "resolve_approval",
				approvalId: "approval-replay",
				decision: "approved",
				comment: "Looks good.",
			},
		);

		const streamResponse = await harness.app.fetch(
			new Request("http://daemon.test/runs/run-replay/events", {
				method: "GET",
				headers: {
					"last-event-id": "3",
				},
			}),
		);

		expect(streamResponse.status).toBe(200);
		const eventsPromise = readSseEvents(streamResponse, 3);

		const cancelResponse = await dispatchDaemonRequest(
			harness.app,
			"POST",
			"/runs/run-replay/control",
			{
				action: "cancel",
				reason: "operator stopped run",
			},
		);
		expect(cancelResponse.status).toBe(200);

		await expect(eventsPromise).resolves.toEqual([
			{
				id: "4",
				event: "approval.requested",
				data: {
					runId: "run-replay",
					sequence: 4,
					type: "approval.requested",
					occurredAt: "2026-03-11T12:00:00.000Z",
					approvalId: "approval-replay",
					stepId: "implement",
					message: "Ship it?",
				},
			},
			{
				id: "5",
				event: "approval.resolved",
				data: {
					runId: "run-replay",
					sequence: 5,
					type: "approval.resolved",
					occurredAt: "2026-03-11T12:00:00.000Z",
					approvalId: "approval-replay",
					decision: "approved",
					comment: "Looks good.",
				},
			},
			{
				id: "6",
				event: "run.cancelled",
				data: {
					runId: "run-replay",
					sequence: 6,
					type: "run.cancelled",
					occurredAt: "2026-03-11T12:00:00.000Z",
					reason: "operator stopped run",
				},
			},
		]);
	});

	test("GET /runs/:id/events rejects invalid Last-Event-ID headers", async () => {
		const harness = await createDaemonTestHarness();

		await dispatchDaemonRequest(harness.app, "POST", "/runs", {
			workflowId: "cross-repo-bugfix",
			configRoot: harness.configRoot,
			repoBindings: harness.repoBindings,
		});

		const invalidHeaderResponse = await harness.app.fetch(
			new Request("http://daemon.test/runs/run-001/events", {
				method: "GET",
				headers: {
					"last-event-id": "banana",
				},
			}),
		);

		expect(invalidHeaderResponse.status).toBe(400);
		expect(await expectJson(invalidHeaderResponse)).toMatchObject({
			ok: false,
			error: expect.objectContaining({
				code: "invalid_http_input",
				message: '"Last-Event-ID" must be a non-negative integer.',
				runId: "run-001",
			}),
		});

		const futureHeaderResponse = await harness.app.fetch(
			new Request("http://daemon.test/runs/run-001/events", {
				method: "GET",
				headers: {
					"last-event-id": "99",
				},
			}),
		);

		expect(futureHeaderResponse.status).toBe(400);
		expect(await expectJson(futureHeaderResponse)).toMatchObject({
			ok: false,
			error: expect.objectContaining({
				code: "invalid_http_input",
				message:
					'"Last-Event-ID" cannot be greater than the latest persisted event sequence for this run.',
				runId: "run-001",
			}),
		});
	});

	test("GET /runs/:id/events reconnects after daemon restart using persisted replay", async () => {
		const harness = await createDaemonTestHarness();
		await seedActiveStepRun(harness, "run-restart");

		const initialStream = await dispatchDaemonRequest(
			harness.app,
			"GET",
			"/runs/run-restart/events",
		);
		const initialEvents = readSseEvents(initialStream, 1);

		const requestApprovalResponse = await dispatchDaemonRequest(
			harness.app,
			"POST",
			"/runs/run-restart/control",
			{
				action: "request_approval",
				approvalId: "approval-restart",
				stepId: "implement",
				message: "Ship it?",
			},
		);
		expect(requestApprovalResponse.status).toBe(200);

		await expect(initialEvents).resolves.toEqual([
			{
				id: "4",
				event: "approval.requested",
				data: {
					runId: "run-restart",
					sequence: 4,
					type: "approval.requested",
					occurredAt: "2026-03-11T12:00:00.000Z",
					approvalId: "approval-restart",
					stepId: "implement",
					message: "Ship it?",
				},
			},
		]);

		const restartedHarness = await reopenDaemonTestHarness(harness, {
			now: () => "2026-03-11T12:10:00.000Z",
		});

		const resolveApprovalResponse = await dispatchDaemonRequest(
			restartedHarness.app,
			"POST",
			"/runs/run-restart/control",
			{
				action: "resolve_approval",
				approvalId: "approval-restart",
				decision: "approved",
				comment: "Looks good after restart.",
			},
		);
		expect(resolveApprovalResponse.status).toBe(200);

		const replayedStream = await restartedHarness.app.fetch(
			new Request("http://daemon.test/runs/run-restart/events", {
				method: "GET",
				headers: {
					"last-event-id": "4",
				},
			}),
		);
		expect(replayedStream.status).toBe(200);
		const resumedEvents = readSseEvents(replayedStream, 2);

		const cancelResponse = await dispatchDaemonRequest(
			restartedHarness.app,
			"POST",
			"/runs/run-restart/control",
			{
				action: "cancel",
				reason: "operator stopped run after restart",
			},
		);
		expect(cancelResponse.status).toBe(200);

		await expect(resumedEvents).resolves.toEqual([
			{
				id: "5",
				event: "approval.resolved",
				data: {
					runId: "run-restart",
					sequence: 5,
					type: "approval.resolved",
					occurredAt: "2026-03-11T12:10:00.000Z",
					approvalId: "approval-restart",
					decision: "approved",
					comment: "Looks good after restart.",
				},
			},
			{
				id: "6",
				event: "run.cancelled",
				data: {
					runId: "run-restart",
					sequence: 6,
					type: "run.cancelled",
					occurredAt: "2026-03-11T12:10:00.000Z",
					reason: "operator stopped run after restart",
				},
			},
		]);
	});

	test("SSE subscriptions clean up on disconnect", async () => {
		const harness = await createDaemonTestHarness();

		await dispatchDaemonRequest(harness.app, "POST", "/runs", {
			workflowId: "cross-repo-bugfix",
			configRoot: harness.configRoot,
			repoBindings: harness.repoBindings,
		});

		const streamResponse = await dispatchDaemonRequest(
			harness.app,
			"GET",
			"/runs/run-001/events",
		);

		expect(harness.eventStreamBroker.subscriberCount("run-001")).toBe(1);

		await streamResponse.body?.cancel();
		await Promise.resolve();

		expect(harness.eventStreamBroker.subscriberCount("run-001")).toBe(0);
	});

	test("POST /runs/:id/control cancels a persisted run", async () => {
		const harness = await createDaemonTestHarness();

		await dispatchDaemonRequest(harness.app, "POST", "/runs", {
			workflowId: "cross-repo-bugfix",
			configRoot: harness.configRoot,
			repoBindings: harness.repoBindings,
		});

		const response = await dispatchDaemonRequest(
			harness.app,
			"POST",
			"/runs/run-001/control",
			{
				action: "cancel",
				reason: "operator stopped run",
			},
		);

		expect(response.status).toBe(200);
		expect(await expectJson(response)).toMatchObject({
			ok: true,
			run: expect.objectContaining({
				runId: "run-001",
				status: "cancelled",
				failureMessage: "operator stopped run",
			}),
		});
	});

	test("POST /runs/:id/control supports approval request and resolve against seeded active steps", async () => {
		const harness = await createDaemonTestHarness();
		await seedActiveStepRun(harness, "run-approval");

		const requestApproval = await dispatchDaemonRequest(
			harness.app,
			"POST",
			"/runs/run-approval/control",
			{
				action: "request_approval",
				approvalId: "approval-001",
				stepId: "implement",
				message: "",
			},
		);

		expect(requestApproval.status).toBe(200);
		expect(await expectJson(requestApproval)).toMatchObject({
			ok: true,
			run: expect.objectContaining({
				status: "waiting_for_approval",
				approvals: [
					expect.objectContaining({
						approvalId: "approval-001",
						status: "pending",
						message: "",
					}),
				],
			}),
		});

		const resolveApproval = await dispatchDaemonRequest(
			harness.app,
			"POST",
			"/runs/run-approval/control",
			{
				action: "resolve_approval",
				approvalId: "approval-001",
				decision: "approved",
				comment: "",
			},
		);

		expect(resolveApproval.status).toBe(200);
		expect(await expectJson(resolveApproval)).toMatchObject({
			ok: true,
			run: expect.objectContaining({
				status: "running",
				approvals: [
					expect.objectContaining({
						approvalId: "approval-001",
						status: "approved",
						comment: "",
					}),
				],
			}),
		});
	});

	test("POST /runs/:id/control does not redispatch non-runtime approvals on the stock local dispatcher", async () => {
		const harness = await createDaemonTestHarness({
			useAppDefaultDispatch: true,
		});
		await seedActiveStepRun(harness, "run-bug");

		const requestApproval = await dispatchDaemonRequest(
			harness.app,
			"POST",
			"/runs/run-bug/control",
			{
				action: "request_approval",
				approvalId: "approval-bug",
				stepId: "implement",
			},
		);
		expect(requestApproval.status).toBe(200);

		const resolveApproval = await dispatchDaemonRequest(
			harness.app,
			"POST",
			"/runs/run-bug/control",
			{
				action: "resolve_approval",
				approvalId: "approval-bug",
				decision: "approved",
			},
		);
		expect(resolveApproval.status).toBe(200);

		await Bun.sleep(20);

		expect(harness.store.readRun("run-bug")).toMatchObject({
			runId: "run-bug",
			status: "running",
			currentStepId: "implement",
			latestEventSequence: 5,
			failureMessage: null,
			approvals: [
				expect.objectContaining({
					approvalId: "approval-bug",
					status: "approved",
				}),
			],
		});
	});

	test("POST /runs/:id/control rejects operator approval ids in the reserved runtime namespace", async () => {
		const harness = await createDaemonTestHarness();
		await seedActiveStepRun(harness, "run-reserved-approval");

		const response = await dispatchDaemonRequest(
			harness.app,
			"POST",
			"/runs/run-reserved-approval/control",
			{
				action: "request_approval",
				approvalId: "approval:implement",
				stepId: "implement",
			},
		);

		expect(response.status).toBe(400);
		expect(await expectJson(response)).toMatchObject({
			ok: false,
			error: expect.objectContaining({
				code: "invalid_http_input",
				message:
					'"approvalId" must not start with "approval:" because that prefix is reserved for runtime-generated approval gates.',
			}),
		});
	});

	test("POST /runs/:id/control supports rejected approvals", async () => {
		const harness = await createDaemonTestHarness();
		await seedActiveStepRun(harness, "run-reject");

		await dispatchDaemonRequest(
			harness.app,
			"POST",
			"/runs/run-reject/control",
			{
				action: "request_approval",
				approvalId: "approval-002",
				stepId: "implement",
			},
		);

		const response = await dispatchDaemonRequest(
			harness.app,
			"POST",
			"/runs/run-reject/control",
			{
				action: "resolve_approval",
				approvalId: "approval-002",
				decision: "rejected",
				comment: "needs changes",
			},
		);

		expect(response.status).toBe(200);
		expect(await expectJson(response)).toMatchObject({
			ok: true,
			run: expect.objectContaining({
				status: "running",
				approvals: [
					expect.objectContaining({
						approvalId: "approval-002",
						status: "rejected",
						comment: "needs changes",
					}),
				],
			}),
		});
	});

	test("POST /runs/:id/control rejects invalid action shapes", async () => {
		const harness = await createDaemonTestHarness();

		const response = await dispatchDaemonRequest(
			harness.app,
			"POST",
			"/runs/missing/control",
			{
				action: "request_approval",
				approvalId: 123,
			},
		);

		expect(response.status).toBe(400);
		expect(await expectJson(response)).toMatchObject({
			ok: false,
			error: expect.objectContaining({
				code: "invalid_http_input",
			}),
		});
	});

	test("POST /runs/:id/control rejects non-JSON content types before mutation", async () => {
		const harness = await createDaemonTestHarness();

		await dispatchDaemonRequest(harness.app, "POST", "/runs", {
			workflowId: "cross-repo-bugfix",
			configRoot: harness.configRoot,
			repoBindings: harness.repoBindings,
		});

		const response = await harness.app.fetch(
			new Request("http://daemon.test/runs/run-001/control", {
				method: "POST",
				headers: {
					"content-type": "text/plain",
					origin: "https://evil.example",
				},
				body: JSON.stringify({
					action: "cancel",
					reason: "evil tab",
				}),
			}),
		);

		expect(response.status).toBe(415);
		expect(await expectJson(response)).toMatchObject({
			ok: false,
			error: expect.objectContaining({
				code: "unsupported_media_type",
			}),
		});
		expect(harness.store.readRun("run-001")).toMatchObject({
			status: "running",
			failureMessage: null,
		});
	});

	test("POST /runs/:id/control rejects non-string optional control fields", async () => {
		const harness = await createDaemonTestHarness();
		await seedActiveStepRun(harness, "run-invalid-optional");

		const requestApproval = await dispatchDaemonRequest(
			harness.app,
			"POST",
			"/runs/run-invalid-optional/control",
			{
				action: "request_approval",
				approvalId: "approval-003",
				stepId: "implement",
				message: 123,
			},
		);

		expect(requestApproval.status).toBe(400);
		expect(await expectJson(requestApproval)).toMatchObject({
			ok: false,
			error: expect.objectContaining({
				code: "invalid_http_input",
				message: '"message" must be a string when provided.',
			}),
		});

		const resolveApproval = await dispatchDaemonRequest(
			harness.app,
			"POST",
			"/runs/run-invalid-optional/control",
			{
				action: "resolve_approval",
				approvalId: "approval-003",
				decision: "approved",
				comment: 456,
			},
		);

		expect(resolveApproval.status).toBe(400);
		expect(await expectJson(resolveApproval)).toMatchObject({
			ok: false,
			error: expect.objectContaining({
				code: "invalid_http_input",
				message: '"comment" must be a string when provided.',
			}),
		});
	});

	test("POST /runs/:id/control rejects oversized control text fields", async () => {
		const harness = await createDaemonTestHarness();
		await seedActiveStepRun(harness, "run-oversized-text");
		const oversizedText = "x".repeat(70_000);

		const cancelResponse = await dispatchDaemonRequest(
			harness.app,
			"POST",
			"/runs/run-oversized-text/control",
			{
				action: "cancel",
				reason: oversizedText,
			},
		);

		expect(cancelResponse.status).toBe(400);
		expect(await expectJson(cancelResponse)).toMatchObject({
			ok: false,
			error: expect.objectContaining({
				code: "invalid_http_input",
				message: '"reason" must be at most 65536 UTF-8 bytes.',
			}),
		});

		const requestApprovalResponse = await dispatchDaemonRequest(
			harness.app,
			"POST",
			"/runs/run-oversized-text/control",
			{
				action: "request_approval",
				approvalId: "approval-oversized",
				stepId: "implement",
				message: oversizedText,
			},
		);

		expect(requestApprovalResponse.status).toBe(400);
		expect(await expectJson(requestApprovalResponse)).toMatchObject({
			ok: false,
			error: expect.objectContaining({
				code: "invalid_http_input",
				message: '"message" must be at most 65536 UTF-8 bytes.',
			}),
		});

		const resolveApprovalResponse = await dispatchDaemonRequest(
			harness.app,
			"POST",
			"/runs/run-oversized-text/control",
			{
				action: "resolve_approval",
				approvalId: "approval-oversized",
				decision: "approved",
				comment: oversizedText,
			},
		);

		expect(resolveApprovalResponse.status).toBe(400);
		expect(await expectJson(resolveApprovalResponse)).toMatchObject({
			ok: false,
			error: expect.objectContaining({
				code: "invalid_http_input",
				message: '"comment" must be at most 65536 UTF-8 bytes.',
			}),
		});
	});

	test("POST /runs/:id/control rejects oversized control identifier fields", async () => {
		const harness = await createDaemonTestHarness();
		await seedActiveStepRun(harness, "run-oversized-id");
		const oversizedIdentifier = "x".repeat(70_000);

		const requestApprovalResponse = await dispatchDaemonRequest(
			harness.app,
			"POST",
			"/runs/run-oversized-id/control",
			{
				action: "request_approval",
				approvalId: oversizedIdentifier,
				stepId: "implement",
			},
		);

		expect(requestApprovalResponse.status).toBe(400);
		expect(await expectJson(requestApprovalResponse)).toMatchObject({
			ok: false,
			error: expect.objectContaining({
				code: "invalid_http_input",
				message: '"approvalId" must be at most 65536 UTF-8 bytes.',
			}),
		});

		const stepIdResponse = await dispatchDaemonRequest(
			harness.app,
			"POST",
			"/runs/run-oversized-id/control",
			{
				action: "request_approval",
				approvalId: "approval-ok",
				stepId: oversizedIdentifier,
			},
		);

		expect(stepIdResponse.status).toBe(400);
		expect(await expectJson(stepIdResponse)).toMatchObject({
			ok: false,
			error: expect.objectContaining({
				code: "invalid_http_input",
				message: '"stepId" must be at most 65536 UTF-8 bytes.',
			}),
		});

		const resolveApprovalResponse = await dispatchDaemonRequest(
			harness.app,
			"POST",
			"/runs/run-oversized-id/control",
			{
				action: "resolve_approval",
				approvalId: oversizedIdentifier,
				decision: "approved",
			},
		);

		expect(resolveApprovalResponse.status).toBe(400);
		expect(await expectJson(resolveApprovalResponse)).toMatchObject({
			ok: false,
			error: expect.objectContaining({
				code: "invalid_http_input",
				message: '"approvalId" must be at most 65536 UTF-8 bytes.',
			}),
		});
	});

	test("POST /runs/:id/control rejects whitespace-only identifiers", async () => {
		const harness = await createDaemonTestHarness();
		await seedActiveStepRun(harness, "run-invalid-identifiers");

		const approvalIdResponse = await dispatchDaemonRequest(
			harness.app,
			"POST",
			"/runs/run-invalid-identifiers/control",
			{
				action: "request_approval",
				approvalId: " ",
				stepId: "implement",
			},
		);

		expect(approvalIdResponse.status).toBe(400);
		expect(await expectJson(approvalIdResponse)).toMatchObject({
			ok: false,
			error: expect.objectContaining({
				code: "invalid_http_input",
				message: '"approvalId" must be a non-empty string.',
			}),
		});

		const stepIdResponse = await dispatchDaemonRequest(
			harness.app,
			"POST",
			"/runs/run-invalid-identifiers/control",
			{
				action: "request_approval",
				approvalId: "approval-004",
				stepId: " ",
			},
		);

		expect(stepIdResponse.status).toBe(400);
		expect(await expectJson(stepIdResponse)).toMatchObject({
			ok: false,
			error: expect.objectContaining({
				code: "invalid_http_input",
				message: '"stepId" must be a non-empty string.',
			}),
		});
	});

	test("POST /runs returns structured JSON for malformed request bodies", async () => {
		const harness = await createDaemonTestHarness();

		const response = await harness.app.fetch(
			new Request("http://daemon.test/runs", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: '{"workflowId":',
			}),
		);

		expect(response.status).toBe(400);
		expect(await expectJson(response)).toMatchObject({
			ok: false,
			error: expect.objectContaining({
				code: "invalid_json_body",
				message: "Request body must be valid JSON.",
			}),
		});
	});

	test("returns structured JSON for malformed percent-encoded paths", async () => {
		const harness = await createDaemonTestHarness();

		const response = await harness.app.fetch(
			new Request("http://daemon.test/runs/%E0%A4%A/control", {
				method: "POST",
			}),
		);

		expect(response.status).toBe(400);
		expect(await expectJson(response)).toMatchObject({
			ok: false,
			error: expect.objectContaining({
				code: "invalid_http_input",
				message: "Request path contains invalid percent-encoding.",
			}),
		});
	});

	test("double-slash control paths do not collapse into run detail routes", async () => {
		const harness = await createDaemonTestHarness();

		await dispatchDaemonRequest(harness.app, "POST", "/runs", {
			workflowId: "cross-repo-bugfix",
			configRoot: harness.configRoot,
			repoBindings: harness.repoBindings,
		});

		const response = await dispatchDaemonRequest(
			harness.app,
			"GET",
			"/runs//control",
		);

		expect(response.status).toBe(404);
		expect(await expectJson(response)).toMatchObject({
			ok: false,
			error: expect.objectContaining({
				code: "route_not_found",
			}),
		});
	});

	test("POST /runs/:id/control returns 409 for invalid transitions", async () => {
		const harness = await createDaemonTestHarness();

		await dispatchDaemonRequest(harness.app, "POST", "/runs", {
			workflowId: "cross-repo-bugfix",
			configRoot: harness.configRoot,
			repoBindings: harness.repoBindings,
		});

		const response = await dispatchDaemonRequest(
			harness.app,
			"POST",
			"/runs/run-001/control",
			{
				action: "request_approval",
				approvalId: "approval-001",
				stepId: "implement",
			},
		);

		expect(response.status).toBe(409);
		expect(await expectJson(response)).toMatchObject({
			ok: false,
			error: expect.objectContaining({
				code: "run_store_invalid_transition",
				runId: "run-001",
			}),
		});
	});

	test("persisted runs survive store reopen for list and detail routes", async () => {
		const harness = await createDaemonTestHarness();

		await dispatchDaemonRequest(harness.app, "POST", "/runs", {
			workflowId: "cross-repo-bugfix",
			configRoot: harness.configRoot,
			repoBindings: harness.repoBindings,
		});
		await dispatchDaemonRequest(harness.app, "POST", "/runs/run-001/control", {
			action: "cancel",
			reason: "done here",
		});
		const reopenedHarness = await reopenDaemonTestHarness(harness, {
			now: () => "2026-03-11T12:10:00.000Z",
		});

		const listResponse = await dispatchDaemonRequest(
			reopenedHarness.app,
			"GET",
			"/runs",
		);
		expect(listResponse.status).toBe(200);
		expect(await expectJson(listResponse)).toEqual({
			ok: true,
			runs: [
				{
					runId: "run-001",
					workflowId: "cross-repo-bugfix",
					workflowName: "Cross-Repo Bugfix",
					status: "cancelled",
					currentStepId: null,
					createdAt: "2026-03-11T12:00:00.000Z",
					updatedAt: "2026-03-11T12:00:00.000Z",
					latestEventSequence: 3,
				},
			],
		});

		const detailResponse = await dispatchDaemonRequest(
			reopenedHarness.app,
			"GET",
			"/runs/run-001",
		);
		expect(detailResponse.status).toBe(200);
		expect(await expectJson(detailResponse)).toMatchObject({
			ok: true,
			run: expect.objectContaining({
				runId: "run-001",
				status: "cancelled",
				failureMessage: "done here",
			}),
		});
	});
});

async function expectJson(response: Response) {
	return readDaemonJson(response);
}

async function waitFor(
	predicate: () => boolean,
	options: {
		attempts?: number;
		delayMs?: number;
	} = {},
) {
	const attempts = options.attempts ?? 40;
	const delayMs = options.delayMs ?? 5;

	for (let attempt = 0; attempt < attempts; attempt += 1) {
		if (predicate()) {
			return;
		}
		await Bun.sleep(delayMs);
	}

	throw new Error("Timed out waiting for asynchronous daemon state change.");
}

async function readSseEvents(response: Response, expectedCount: number) {
	const reader = response.body?.getReader();
	if (!reader) {
		throw new Error("Expected SSE response body to be readable.");
	}

	const decoder = new TextDecoder();
	const events: Array<{
		id: string | null;
		event: string | null;
		data: unknown;
	}> = [];
	let buffer = "";

	try {
		while (events.length < expectedCount) {
			const result = await reader.read();
			if (result.done) {
				break;
			}

			buffer += decoder.decode(result.value, { stream: true });
			const messages = buffer.split("\n\n");
			buffer = messages.pop() ?? "";

			for (const message of messages) {
				const event = parseSseMessage(message);
				if (event) {
					events.push(event);
					if (events.length === expectedCount) {
						break;
					}
				}
			}
		}
	} finally {
		await reader.cancel();
	}

	return events;
}

function parseSseMessage(message: string) {
	if (message.trim().length === 0 || message.startsWith(":")) {
		return null;
	}

	let id: string | null = null;
	let event: string | null = null;
	let data: string | null = null;

	for (const line of message.split("\n")) {
		if (line.startsWith("id:")) {
			id = line.slice(3).trimStart();
			continue;
		}
		if (line.startsWith("event:")) {
			event = line.slice(6).trimStart();
			continue;
		}
		if (line.startsWith("data:")) {
			data = line.slice(5).trimStart();
		}
	}

	return {
		id,
		event,
		data: data === null ? null : JSON.parse(data),
	};
}

function makeApprovalWorkflow(command: string) {
	return makeWorkflow({
		nodes: [
			{
				id: "trigger",
				kind: "trigger" as const,
				label: "Manual Trigger",
				phaseId: "intake",
				settings: { template: "trigger.manual" as const },
			},
			{
				id: "implement",
				kind: "task" as const,
				label: "Implement",
				phaseId: "implementation",
				target: { repoId: "agent-console" },
				settings: {
					template: "task.agent" as const,
					prompt: "Patch the bug and summarize the diff.",
				},
			},
			{
				id: "approve",
				kind: "gate" as const,
				label: "Approve",
				phaseId: "output",
				settings: {
					template: "gate.approval" as const,
					message: "Approve the patch",
				},
			},
			{
				id: "typecheck",
				kind: "check" as const,
				label: "Typecheck",
				phaseId: "output",
				target: { repoId: "agent-console" },
				settings: {
					template: "check.shell" as const,
					command,
				},
			},
			{
				id: "terminal",
				kind: "terminal" as const,
				label: "Done",
				phaseId: "output",
				settings: { template: "terminal.complete" as const },
			},
		],
		edges: [
			{
				id: "edge-trigger-implement",
				sourceId: "trigger",
				targetId: "implement",
				condition: "always" as const,
			},
			{
				id: "edge-implement-approve",
				sourceId: "implement",
				targetId: "approve",
				condition: "on_success" as const,
			},
			{
				id: "edge-approve-typecheck",
				sourceId: "approve",
				targetId: "typecheck",
				condition: "on_approval" as const,
			},
			{
				id: "edge-typecheck-terminal",
				sourceId: "typecheck",
				targetId: "terminal",
				condition: "on_success" as const,
			},
		],
	});
}
