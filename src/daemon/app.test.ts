import { afterEach, describe, expect, test } from "bun:test";
import {
	cleanupDaemonTestHarnesses,
	createDaemonTestHarness,
	dispatchDaemonRequest,
	readDaemonJson,
	reopenDaemonTestHarness,
	seedActiveStepRun,
} from "./test-helpers.ts";

afterEach(async () => {
	await cleanupDaemonTestHarnesses();
});

describe("daemon app", () => {
	test("POST /runs creates and auto-starts a persisted run", async () => {
		const harness = await createDaemonTestHarness();

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
