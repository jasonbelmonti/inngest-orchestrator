import { afterEach, describe, expect, test } from "bun:test";
import { createDaemonApp } from "./app.ts";
import { SQLiteRunStore } from "../runs/store/sqlite-store.ts";
import {
	attachOpenStore,
	cleanupDaemonTestHarnesses,
	createDaemonTestHarness,
	detachOpenStore,
	dispatchDaemonRequest,
	readDaemonJson,
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

		harness.store.close();
		detachOpenStore(harness.store);

		const reopenedStore = SQLiteRunStore.open({
			databasePath: harness.databasePath,
		});
		attachOpenStore(reopenedStore);
		const reopenedApp = createDaemonApp({
			store: reopenedStore,
			generateRunId: () => "unused",
			now: () => "2026-03-11T12:10:00.000Z",
		});

		const listResponse = await dispatchDaemonRequest(
			reopenedApp,
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
			reopenedApp,
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
