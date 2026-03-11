import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SQLiteRunStore } from "./store/index.ts";
import type { ResolvedRunLaunchRequest } from "./types.ts";

const tempDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempDirectories.map((directory) =>
			rm(directory, { recursive: true, force: true }),
		),
	);
	tempDirectories.length = 0;
});

describe("SQLiteRunStore", () => {
	test("persists a created run and reads it back", async () => {
		const store = SQLiteRunStore.open();

		const result = store.createRun({
			runId: "run-001",
			createdAt: "2026-03-10T10:00:00.000Z",
			launch: makeResolvedLaunchRequest(),
		});

		expect(result).toMatchObject({
			runId: "run-001",
			status: "created",
			latestEventSequence: 1,
			launch: expect.objectContaining({
				workflow: expect.objectContaining({
					workflowId: "cross-repo-bugfix",
				}),
			}),
		});
		expect(store.readRun("run-001")).toEqual(result);
		expect(store.listEvents("run-001")).toEqual([
			expect.objectContaining({
				runId: "run-001",
				sequence: 1,
				type: "run.created",
			}),
		]);

		store.close();
	});

	test("updates projections deterministically as events are appended", () => {
		const store = SQLiteRunStore.open();

		store.createRun({
			runId: "run-002",
			createdAt: "2026-03-10T10:00:00.000Z",
			launch: makeResolvedLaunchRequest(),
		});
		store.appendEvent({
			runId: "run-002",
			event: {
				type: "run.started",
				occurredAt: "2026-03-10T10:00:01.000Z",
			},
		});
		store.appendEvent({
			runId: "run-002",
			event: {
				type: "step.started",
				occurredAt: "2026-03-10T10:00:02.000Z",
				stepId: "implement",
			},
		});
		store.appendEvent({
			runId: "run-002",
			event: {
				type: "artifact.created",
				occurredAt: "2026-03-10T10:00:03.000Z",
				artifactId: "artifact-001",
				stepId: "implement",
				kind: "diff",
				repoId: "agent-console",
				relativePath: "src/main.ts",
				metadata: { linesChanged: 12 },
			},
		});
		const result = store.appendEvent({
			runId: "run-002",
			event: {
				type: "run.completed",
				occurredAt: "2026-03-10T10:00:04.000Z",
			},
		});

		expect(result).toMatchObject({
			status: "completed",
			currentStepId: null,
			latestEventSequence: 5,
			completedAt: "2026-03-10T10:00:04.000Z",
			artifacts: [
				expect.objectContaining({
					artifactId: "artifact-001",
					relativePath: "src/main.ts",
					metadata: { linesChanged: 12 },
				}),
			],
		});
		expect(store.listRuns().map((run) => run.runId)).toEqual(["run-002"]);

		store.close();
	});

	test("clears transient step failure messages after a later successful completion", () => {
		const store = SQLiteRunStore.open();

		store.createRun({
			runId: "run-002b",
			createdAt: "2026-03-10T10:00:00.000Z",
			launch: makeResolvedLaunchRequest(),
		});
		store.appendEvent({
			runId: "run-002b",
			event: {
				type: "run.started",
				occurredAt: "2026-03-10T10:00:01.000Z",
			},
		});
		store.appendEvent({
			runId: "run-002b",
			event: {
				type: "step.started",
				occurredAt: "2026-03-10T10:00:02.000Z",
				stepId: "step-a",
			},
		});
		store.appendEvent({
			runId: "run-002b",
			event: {
				type: "step.failed",
				occurredAt: "2026-03-10T10:00:03.000Z",
				stepId: "step-a",
				message: "first failed",
			},
		});
		store.appendEvent({
			runId: "run-002b",
			event: {
				type: "step.started",
				occurredAt: "2026-03-10T10:00:04.000Z",
				stepId: "step-b",
			},
		});
		store.appendEvent({
			runId: "run-002b",
			event: {
				type: "step.completed",
				occurredAt: "2026-03-10T10:00:05.000Z",
				stepId: "step-b",
			},
		});
		const result = store.appendEvent({
			runId: "run-002b",
			event: {
				type: "run.completed",
				occurredAt: "2026-03-10T10:00:06.000Z",
			},
		});

		expect(result).toMatchObject({
			status: "completed",
			failureMessage: null,
		});

		store.close();
	});

	test("tracks approval requests and resolution state", () => {
		const store = SQLiteRunStore.open();

		store.createRun({
			runId: "run-003",
			createdAt: "2026-03-10T10:00:00.000Z",
			launch: makeResolvedLaunchRequest(),
		});
		store.appendEvent({
			runId: "run-003",
			event: {
				type: "run.started",
				occurredAt: "2026-03-10T10:00:01.000Z",
			},
		});
		store.appendEvent({
			runId: "run-003",
			event: {
				type: "step.started",
				occurredAt: "2026-03-10T10:00:02.000Z",
				stepId: "approval",
			},
		});
		store.appendEvent({
			runId: "run-003",
			event: {
				type: "approval.requested",
				occurredAt: "2026-03-10T10:00:03.000Z",
				approvalId: "approval-001",
				stepId: "approval",
				message: "Ship it?",
			},
		});
		const result = store.appendEvent({
			runId: "run-003",
			event: {
				type: "approval.resolved",
				occurredAt: "2026-03-10T10:00:04.000Z",
				approvalId: "approval-001",
				decision: "approved",
				comment: "Looks good.",
			},
		});

		expect(result.status).toBe("running");
		expect(result.approvals).toEqual([
			expect.objectContaining({
				approvalId: "approval-001",
				status: "approved",
				decision: "approved",
				comment: "Looks good.",
			}),
		]);

		store.close();
	});

	test("scopes approval and artifact ids to a run instead of the whole database", () => {
		const store = SQLiteRunStore.open();

		for (const runId of ["run-003a", "run-003b"]) {
			store.createRun({
				runId,
				createdAt: "2026-03-10T10:00:00.000Z",
				launch: makeResolvedLaunchRequest(),
			});
			store.appendEvent({
				runId,
				event: {
					type: "run.started",
					occurredAt: "2026-03-10T10:00:01.000Z",
				},
			});
			store.appendEvent({
				runId,
				event: {
					type: "step.started",
					occurredAt: "2026-03-10T10:00:02.000Z",
					stepId: "build",
				},
			});
			store.appendEvent({
				runId,
				event: {
					type: "approval.requested",
					occurredAt: "2026-03-10T10:00:03.000Z",
					approvalId: "approval-1",
					stepId: "build",
				},
			});
			store.appendEvent({
				runId,
				event: {
					type: "approval.resolved",
					occurredAt: "2026-03-10T10:00:04.000Z",
					approvalId: "approval-1",
					decision: "approved",
				},
			});
			store.appendEvent({
				runId,
				event: {
					type: "artifact.created",
					occurredAt: "2026-03-10T10:00:05.000Z",
					artifactId: "artifact-1",
					stepId: "build",
					kind: "report",
					relativePath: `${runId}/summary.md`,
				},
			});
		}

		expect(store.readRun("run-003a")?.approvals).toEqual([
			expect.objectContaining({ approvalId: "approval-1" }),
		]);
		expect(store.readRun("run-003b")?.artifacts).toEqual([
			expect.objectContaining({ artifactId: "artifact-1" }),
		]);

		store.close();
	});

	test("preserves replay cursors across projection rebuilds", async () => {
		const databasePath = await createDatabasePath();
		const first = SQLiteRunStore.open({ databasePath });

		first.createRun({
			runId: "run-003d",
			createdAt: "2026-03-10T10:00:00.000Z",
			launch: makeResolvedLaunchRequest(),
		});
		first.appendEvent({
			runId: "run-003d",
			event: {
				type: "run.started",
				occurredAt: "2026-03-10T10:00:01.000Z",
			},
		});
		first.saveCursor({
			runId: "run-003d",
			lastEventSequence: 1,
			updatedAt: "2026-03-10T10:00:02.000Z",
		});
		first.close();

		const reopened = SQLiteRunStore.open({ databasePath });

		expect(reopened.readCursor("run-003d")).toEqual({
			runId: "run-003d",
			lastEventSequence: 1,
			updatedAt: "2026-03-10T10:00:02.000Z",
		});

		reopened.close();
	});

	test("round-trips empty-string approval text", () => {
		const store = SQLiteRunStore.open();

		store.createRun({
			runId: "run-003c",
			createdAt: "2026-03-10T10:00:00.000Z",
			launch: makeResolvedLaunchRequest(),
		});
		store.appendEvent({
			runId: "run-003c",
			event: {
				type: "run.started",
				occurredAt: "2026-03-10T10:00:01.000Z",
			},
		});
		store.appendEvent({
			runId: "run-003c",
			event: {
				type: "step.started",
				occurredAt: "2026-03-10T10:00:02.000Z",
				stepId: "approval",
			},
		});
		store.appendEvent({
			runId: "run-003c",
			event: {
				type: "approval.requested",
				occurredAt: "2026-03-10T10:00:03.000Z",
				approvalId: "approval-empty",
				stepId: "approval",
				message: "",
			},
		});
		const result = store.appendEvent({
			runId: "run-003c",
			event: {
				type: "approval.resolved",
				occurredAt: "2026-03-10T10:00:04.000Z",
				approvalId: "approval-empty",
				decision: "approved",
				comment: "",
			},
		});

		expect(result.approvals).toEqual([
			expect.objectContaining({
				approvalId: "approval-empty",
				message: "",
				comment: "",
			}),
		]);

		store.close();
	});

	test("persists cancel and failure terminal states", () => {
		const store = SQLiteRunStore.open();

		store.createRun({
			runId: "run-004",
			createdAt: "2026-03-10T10:00:00.000Z",
			launch: makeResolvedLaunchRequest(),
		});
		const cancelled = store.appendEvent({
			runId: "run-004",
			event: {
				type: "run.cancelled",
				occurredAt: "2026-03-10T10:00:01.000Z",
				reason: "User cancelled the run.",
			},
		});
		expect(cancelled).toMatchObject({
			status: "cancelled",
			cancelledAt: "2026-03-10T10:00:01.000Z",
			failureMessage: "User cancelled the run.",
		});

		store.createRun({
			runId: "run-005",
			createdAt: "2026-03-10T11:00:00.000Z",
			launch: makeResolvedLaunchRequest(),
		});
		store.appendEvent({
			runId: "run-005",
			event: {
				type: "run.started",
				occurredAt: "2026-03-10T11:00:01.000Z",
			},
		});
		const failed = store.appendEvent({
			runId: "run-005",
			event: {
				type: "run.failed",
				occurredAt: "2026-03-10T11:00:02.000Z",
				message: "Shell check failed.",
			},
		});
		expect(failed).toMatchObject({
			status: "failed",
			failedAt: "2026-03-10T11:00:02.000Z",
			failureMessage: "Shell check failed.",
		});

		store.close();
	});

	test("fails closed on invalid transitions with machine-readable errors", () => {
		const store = SQLiteRunStore.open();

		store.createRun({
			runId: "run-006",
			createdAt: "2026-03-10T10:00:00.000Z",
			launch: makeResolvedLaunchRequest(),
		});

		expect(() =>
			store.appendEvent({
				runId: "run-006",
				event: {
					type: "run.completed",
					occurredAt: "2026-03-10T10:00:01.000Z",
				},
			}),
		).toThrow(
			expect.objectContaining({
				code: "run_store_invalid_transition",
			}),
		);

		expect(() =>
			store.createRun({
				runId: "run-006",
				createdAt: "2026-03-10T10:00:02.000Z",
				launch: makeResolvedLaunchRequest(),
			}),
		).toThrow(
			expect.objectContaining({
				code: "run_store_conflict",
			}),
		);

		store.appendEvent({
			runId: "run-006",
			event: {
				type: "run.started",
				occurredAt: "2026-03-10T10:00:03.000Z",
			},
		});
		store.appendEvent({
			runId: "run-006",
			event: {
				type: "step.started",
				occurredAt: "2026-03-10T10:00:04.000Z",
				stepId: "step-a",
			},
		});

		expect(() =>
			store.appendEvent({
				runId: "run-006",
				event: {
					type: "step.started",
					occurredAt: "2026-03-10T10:00:05.000Z",
					stepId: "step-b",
				},
			}),
		).toThrow(
			expect.objectContaining({
				code: "run_store_invalid_transition",
			}),
		);

		const terminalStore = SQLiteRunStore.open();
		terminalStore.createRun({
			runId: "run-006b",
			createdAt: "2026-03-10T10:00:00.000Z",
			launch: makeResolvedLaunchRequest(),
		});
		terminalStore.appendEvent({
			runId: "run-006b",
			event: {
				type: "run.started",
				occurredAt: "2026-03-10T10:00:01.000Z",
			},
		});
		terminalStore.appendEvent({
			runId: "run-006b",
			event: {
				type: "run.completed",
				occurredAt: "2026-03-10T10:00:02.000Z",
			},
		});

		expect(() =>
			terminalStore.appendEvent({
				runId: "run-006b",
				event: {
					type: "artifact.created",
					occurredAt: "2026-03-10T10:00:03.000Z",
					artifactId: "artifact-terminal",
					stepId: "step",
					kind: "report",
					relativePath: "summary.md",
				},
			}),
		).toThrow(
			expect.objectContaining({
				code: "run_store_invalid_transition",
			}),
		);

		terminalStore.close();

		expect(() =>
			store.appendEvent({
				runId: "run-006",
				event: {
					type: "approval.requested",
					occurredAt: "2026-03-10T10:00:06.000Z",
					approvalId: "approval-2",
					stepId: "different-step",
				},
			}),
		).toThrow(
			expect.objectContaining({
				code: "run_store_invalid_transition",
			}),
		);

		const artifactStore = SQLiteRunStore.open();
		artifactStore.createRun({
			runId: "run-006c",
			createdAt: "2026-03-10T10:00:00.000Z",
			launch: makeResolvedLaunchRequest(),
		});
		artifactStore.appendEvent({
			runId: "run-006c",
			event: {
				type: "run.started",
				occurredAt: "2026-03-10T10:00:01.000Z",
			},
		});
		artifactStore.appendEvent({
			runId: "run-006c",
			event: {
				type: "step.started",
				occurredAt: "2026-03-10T10:00:02.000Z",
				stepId: "step-a",
			},
		});

		expect(() =>
			artifactStore.appendEvent({
				runId: "run-006c",
				event: {
					type: "artifact.created",
					occurredAt: "2026-03-10T10:00:03.000Z",
					artifactId: "artifact-mismatch",
					stepId: "step-b",
					kind: "report",
					relativePath: "summary.md",
				},
			}),
		).toThrow(
			expect.objectContaining({
				code: "run_store_invalid_transition",
			}),
		);

		artifactStore.appendEvent({
			runId: "run-006c",
			event: {
				type: "step.completed",
				occurredAt: "2026-03-10T10:00:04.000Z",
				stepId: "step-a",
			},
		});

		expect(() =>
			artifactStore.appendEvent({
				runId: "run-006c",
				event: {
					type: "artifact.created",
					occurredAt: "2026-03-10T10:00:05.000Z",
					artifactId: "artifact-no-active-step",
					stepId: "step-a",
					kind: "report",
					relativePath: "summary.md",
				},
			}),
		).toThrow(
			expect.objectContaining({
				code: "run_store_invalid_transition",
			}),
		);

		artifactStore.close();

		expect(() =>
			store.appendEvent({
				runId: "missing-run",
				event: {
					type: "run.started",
					occurredAt: "2026-03-10T10:00:01.000Z",
				},
			}),
		).toThrow(
			expect.objectContaining({
				code: "run_store_not_found",
			}),
		);

		store.close();
	});

	test("rebuilds projections from stored events after reopening the database", async () => {
		const databasePath = await createDatabasePath();
		const first = SQLiteRunStore.open({ databasePath });

		first.createRun({
			runId: "run-007",
			createdAt: "2026-03-10T10:00:00.000Z",
			launch: makeResolvedLaunchRequest(),
		});
		first.appendEvent({
			runId: "run-007",
			event: {
				type: "run.started",
				occurredAt: "2026-03-10T10:00:01.000Z",
			},
		});
		first.appendEvent({
			runId: "run-007",
			event: {
				type: "step.started",
				occurredAt: "2026-03-10T10:00:02.000Z",
				stepId: "implement",
			},
		});
		first.appendEvent({
			runId: "run-007",
			event: {
				type: "artifact.created",
				occurredAt: "2026-03-10T10:00:03.000Z",
				artifactId: "artifact-002",
				stepId: "implement",
				kind: "report",
				relativePath: "reports/summary.md",
			},
		});
		first.close();

		const reopened = SQLiteRunStore.open({ databasePath });
		const result = reopened.readRun("run-007");

		expect(result).toMatchObject({
			runId: "run-007",
			status: "running",
			currentStepId: "implement",
			latestEventSequence: 4,
			artifacts: [
				expect.objectContaining({
					artifactId: "artifact-002",
					relativePath: "reports/summary.md",
				}),
			],
		});
		expect(reopened.listEvents("run-007")).toHaveLength(4);

		reopened.close();
	});
});

function makeResolvedLaunchRequest(): ResolvedRunLaunchRequest {
	return {
		configRoot: "/tmp/workflows",
		workflow: {
			workflowId: "cross-repo-bugfix",
			name: "Cross-Repo Bugfix",
			summary: "Example workflow",
			contentHash: "abc123",
			filePath: "/tmp/workflows/workflows/cross-repo-bugfix.json",
		},
		repoBindings: [
			{
				repoId: "agent-console",
				label: "Agent Console",
				required: true,
				status: "resolved",
				resolvedPath: "/tmp/agent-console",
			},
			{
				repoId: "inngest-orchestrator",
				label: "Inngest Orchestrator",
				required: true,
				status: "resolved",
				resolvedPath: "/tmp/inngest-orchestrator",
			},
		],
	};
}

async function createDatabasePath() {
	const directory = await mkdtemp(join(tmpdir(), "inngest-orchestrator-runs-db-"));
	tempDirectories.push(directory);
	return join(directory, "runs.sqlite");
}
