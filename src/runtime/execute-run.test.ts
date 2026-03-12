import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRunLaunchRequest } from "../runs/repo-bindings.ts";
import { SQLiteRunStore } from "../runs/store/index.ts";
import {
	makeRepositoryCatalog,
	makeWorkflow,
} from "../workflows/test-fixtures.ts";
import { executePersistedRun } from "./execute-run.ts";

const createdRoots: string[] = [];
const openedStores: SQLiteRunStore[] = [];

describe("executePersistedRun", () => {
	afterEach(async () => {
		for (const store of openedStores) {
			store.close();
		}
		openedStores.length = 0;

		await Promise.all(
			createdRoots.map(async (root) => {
				await Bun.$`rm -rf ${root}`.quiet();
			}),
		);
		createdRoots.length = 0;
	});

	test("executes the BEL-366 subset to durable completion", async () => {
		const fixture = await createRuntimeFixture({
			command: "printf 'shell-ok\\n'",
		});
		const store = SQLiteRunStore.open();
		openedStores.push(store);
		const clock = createDeterministicClock();

		store.createStartedRun({
			runId: "run-001",
			createdAt: clock(),
			startedAt: clock(),
			launch: fixture.launch,
		});

		const run = await executePersistedRun({
			runId: "run-001",
			store,
			now: clock,
		});

		expect(run.status).toBe("completed");
		expect(run.failureMessage).toBeNull();
		expect(run.artifacts).toEqual([
			expect.objectContaining({
				artifactId: "shell-check:typecheck",
				stepId: "typecheck",
				kind: "shell-check-report",
				repoId: "agent-console",
				relativePath:
					".inngest-orchestrator/artifacts/runs/run-001/steps/typecheck/shell-check.json",
			}),
		]);
		expect(store.listEvents("run-001").map((event) => event.type)).toEqual([
			"run.created",
			"run.started",
			"step.started",
			"step.completed",
			"step.started",
			"artifact.created",
			"step.completed",
			"step.started",
			"step.completed",
			"run.completed",
		]);
		const artifact = run.artifacts[0];
		if (!artifact) {
			throw new Error("Expected BEL-373 success path artifact.");
		}

		const artifactFile = await Bun.file(
			join(fixture.agentConsolePath, artifact.relativePath),
		).json();
		expect(artifactFile).toEqual(
			expect.objectContaining({
				runId: "run-001",
				stepId: "typecheck",
				exitCode: 0,
				status: "completed",
				stdout: {
					text: "shell-ok\n",
					byteLength: Buffer.byteLength("shell-ok\n"),
				},
			}),
		);
	});

	test("records shell-check failure durably without bypassing the run store", async () => {
		const fixture = await createRuntimeFixture({
			command: "printf 'shell-bad\\n' >&2; exit 7",
		});
		const store = SQLiteRunStore.open();
		openedStores.push(store);
		const clock = createDeterministicClock();

		store.createStartedRun({
			runId: "run-002",
			createdAt: clock(),
			startedAt: clock(),
			launch: fixture.launch,
		});

		const run = await executePersistedRun({
			runId: "run-002",
			store,
			now: clock,
		});

		expect(run.status).toBe("failed");
		expect(run.failureMessage).toBe(
			'Shell-check step "typecheck" exited with code 7.',
		);
		expect(store.listEvents("run-002").map((event) => event.type)).toEqual([
			"run.created",
			"run.started",
			"step.started",
			"step.completed",
			"step.started",
			"artifact.created",
			"step.failed",
			"run.failed",
		]);
		expect(run.artifacts).toEqual([
			expect.objectContaining({
				artifactId: "shell-check:typecheck",
				stepId: "typecheck",
			}),
		]);
		const artifact = run.artifacts[0];
		if (!artifact) {
			throw new Error("Expected BEL-373 failure path artifact.");
		}

		const artifactFile = await Bun.file(
			join(fixture.agentConsolePath, artifact.relativePath),
		).json();
		expect(artifactFile).toEqual(
			expect.objectContaining({
				runId: "run-002",
				stepId: "typecheck",
				exitCode: 7,
				status: "failed",
				stderr: {
					text: "shell-bad\n",
					byteLength: Buffer.byteLength("shell-bad\n"),
				},
			}),
		);
	});

	test("fails closed when asked to execute a partially advanced running run", async () => {
		const fixture = await createRuntimeFixture({
			command: "printf 'unused\\n'",
		});
		const store = SQLiteRunStore.open();
		openedStores.push(store);
		const clock = createDeterministicClock();

		store.createStartedRun({
			runId: "run-003",
			createdAt: clock(),
			startedAt: clock(),
			launch: fixture.launch,
		});
		store.appendEvent({
			runId: "run-003",
			event: {
				type: "step.started",
				occurredAt: clock(),
				stepId: "implement",
			},
		});

		const run = await executePersistedRun({
			runId: "run-003",
			store,
			now: clock,
		});

		expect(run.status).toBe("failed");
		expect(run.failureMessage).toBe(
			'Persisted run "run-003" cannot resume after partial BEL-373 execution progress.',
		);
		expect(store.listEvents("run-003").map((event) => event.type)).toEqual([
			"run.created",
			"run.started",
			"step.started",
			"step.failed",
			"run.failed",
		]);
	});

	test("pauses durably when execution reaches an approval gate", async () => {
		const fixture = await createRuntimeFixture({
			command: "printf 'unused\\n'",
			includeApprovalGate: true,
		});
		const store = SQLiteRunStore.open();
		openedStores.push(store);
		const clock = createDeterministicClock();

		store.createStartedRun({
			runId: "run-004",
			createdAt: clock(),
			startedAt: clock(),
			launch: fixture.launch,
		});

		const run = await executePersistedRun({
			runId: "run-004",
			store,
			now: clock,
		});

		expect(run.status).toBe("waiting_for_approval");
		expect(run.currentStepId).toBe("approve");
		expect(run.failureMessage).toBeNull();
		expect(run.approvals).toEqual([
			{
				approvalId: "approval:approve",
				runId: "run-004",
				stepId: "approve",
				status: "pending",
				requestedAt: "2026-03-12T18:00:06.000Z",
				respondedAt: null,
				decision: null,
				message: "Ship it?",
			},
		]);
		expect(store.listEvents("run-004").map((event) => event.type)).toEqual([
			"run.created",
			"run.started",
			"step.started",
			"step.completed",
			"step.started",
			"approval.requested",
		]);
	});
});

async function createRuntimeFixture(input: {
	command: string;
	includeApprovalGate?: boolean;
}) {
	const root = await mkdtemp(join(tmpdir(), "runtime-executor-"));
	createdRoots.push(root);

	const configRoot = join(root, "config-root");
	const agentConsolePath = join(root, "agent-console");
	const orchestratorPath = join(root, "inngest-orchestrator");
	await mkdir(join(configRoot, "repos"), { recursive: true });
	await mkdir(join(configRoot, "workflows"), { recursive: true });
	await mkdir(agentConsolePath, { recursive: true });
	await mkdir(orchestratorPath, { recursive: true });

	await Bun.write(
		join(configRoot, "repos", "workspace.repos.json"),
		`${JSON.stringify(makeRepositoryCatalog(), null, 2)}\n`,
	);
	await Bun.write(
		join(configRoot, "workflows", "cross-repo-bugfix.json"),
		`${JSON.stringify(makeRuntimeWorkflowFixture(input), null, 2)}\n`,
	);

	const launch = await resolveRunLaunchRequest({
		configRoot,
		workflowId: "cross-repo-bugfix",
		repoBindings: {
			"agent-console": agentConsolePath,
			"inngest-orchestrator": orchestratorPath,
		},
	});

	return {
		configRoot,
		launch,
		agentConsolePath,
		orchestratorPath,
	};
}

function makeRuntimeWorkflowFixture(input: {
	command: string;
	includeApprovalGate?: boolean;
}) {
	const baseWorkflow = makeWorkflow();
	const nodes = baseWorkflow.nodes.map((node) =>
		node.id === "typecheck"
			? {
					...node,
					settings: {
						...node.settings,
						command: input.command,
					},
				}
			: node,
	);

	if (!input.includeApprovalGate) {
		return makeWorkflow({ nodes });
	}

	return makeWorkflow({
		nodes: nodes.flatMap((node) =>
			node.id === "typecheck"
				? [
						{
							id: "approve",
							kind: "gate" as const,
							label: "Approve Changes",
							phaseId: "output",
							settings: {
								template: "gate.approval",
								message: "Ship it?",
							},
						},
						node,
					]
				: [node],
		),
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

function createDeterministicClock() {
	let tick = 0;
	return () => {
		tick += 1;
		return new Date(Date.UTC(2026, 2, 12, 18, 0, tick)).toISOString();
	};
}
