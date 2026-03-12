import { RunStoreError, type SQLiteRunStore } from "../runs/store/index.ts";
import { WorkflowStore } from "../workflows/store.ts";
import { createRuntimeExecutionPlan } from "./execution-plan.ts";
import { executeShellCheck } from "./shell-check.ts";
import type { RuntimeExecutionPlanStep } from "./types.ts";

interface ExecutePersistedRunOptions {
	runId: string;
	store: SQLiteRunStore;
	now?: () => string;
}

export async function executePersistedRun(input: ExecutePersistedRunOptions) {
	const now = input.now ?? (() => new Date().toISOString());
	const initialRun = input.store.readRun(input.runId);
	if (!initialRun) {
		throw new RunStoreError({
			code: "run_store_not_found",
			message: `Run "${input.runId}" was not found.`,
		});
	}

	if (initialRun.status !== "running") {
		return initialRun;
	}
	if (initialRun.latestEventSequence > 2 || initialRun.currentStepId !== null) {
		return failPersistedRunExecution({
			runId: input.runId,
			store: input.store,
			now,
			error: new Error(
				`Persisted run "${input.runId}" cannot resume after partial BEL-373 execution progress.`,
			),
		});
	}

	try {
		const workflowStore = await WorkflowStore.open({
			configRoot: initialRun.launch.configRoot,
		});
		const workflowRecord = await workflowStore.readWorkflow(
			initialRun.launch.workflow.workflowId,
		);
		const plan = createRuntimeExecutionPlan({
			run: {
				runId: initialRun.runId,
				launch: initialRun.launch,
			},
			workflowRecord,
		});

		let run = initialRun;
		for (const step of plan.steps) {
			run = await executeRuntimeStep(initialRun.runId, step, input.store, now);

			if (
				run.status === "failed" ||
				run.status === "completed" ||
				run.status === "waiting_for_approval"
			) {
				return run;
			}
		}

		throw new Error(
			`Runtime execution for run "${input.runId}" did not reach a terminal state.`,
		);
	} catch (error) {
		return failPersistedRunExecution({
			runId: input.runId,
			store: input.store,
			now,
			error,
		});
	}
}

async function executeRuntimeStep(
	runId: string,
	step: RuntimeExecutionPlanStep,
	store: SQLiteRunStore,
	now: () => string,
) {
	switch (step.kind) {
		case "task":
			return executeTaskStep({ runId, step, store, now });
		case "check":
			return executeCheckStep({ runId, step, store, now });
		case "approval":
			return executeApprovalStep({ runId, step, store, now });
		case "terminal":
			return executeTerminalStep({ runId, step, store, now });
	}
}

function executeTaskStep(input: {
	runId: string;
	step: Extract<RuntimeExecutionPlanStep, { kind: "task" }>;
	store: SQLiteRunStore;
	now: () => string;
}) {
	const startedAt = input.now();
	input.store.appendEvent({
		runId: input.runId,
		event: {
			type: "step.started",
			occurredAt: startedAt,
			stepId: input.step.id,
		},
	});
	return input.store.appendEvent({
		runId: input.runId,
		event: {
			type: "step.completed",
			occurredAt: input.now(),
			stepId: input.step.id,
		},
	});
}

async function executeCheckStep(input: {
	runId: string;
	step: Extract<RuntimeExecutionPlanStep, { kind: "check" }>;
	store: SQLiteRunStore;
	now: () => string;
}) {
	input.store.appendEvent({
		runId: input.runId,
		event: {
			type: "step.started",
			occurredAt: input.now(),
			stepId: input.step.id,
		},
	});

	const result = await executeShellCheck({
		runId: input.runId,
		step: input.step,
	});
	input.store.appendEvent({
		runId: input.runId,
		event: {
			type: "artifact.created",
			occurredAt: input.now(),
			artifactId: createShellCheckArtifactId(input.step.id),
			stepId: input.step.id,
			kind: result.artifact.kind,
			repoId: result.artifact.repoId,
			relativePath: result.artifact.relativePath,
			metadata: result.artifact.metadata as Record<string, unknown>,
		},
	});

	if (result.status === "completed") {
		return input.store.appendEvent({
			runId: input.runId,
			event: {
				type: "step.completed",
				occurredAt: input.now(),
				stepId: input.step.id,
			},
		});
	}

	const message = `Shell-check step "${input.step.id}" exited with code ${result.exitCode}.`;
	input.store.appendEvent({
		runId: input.runId,
		event: {
			type: "step.failed",
			occurredAt: input.now(),
			stepId: input.step.id,
			message,
		},
	});
	return input.store.appendEvent({
		runId: input.runId,
		event: {
			type: "run.failed",
			occurredAt: input.now(),
			message,
		},
	});
}

function executeApprovalStep(input: {
	runId: string;
	step: Extract<RuntimeExecutionPlanStep, { kind: "approval" }>;
	store: SQLiteRunStore;
	now: () => string;
}) {
	input.store.appendEvent({
		runId: input.runId,
		event: {
			type: "step.started",
			occurredAt: input.now(),
			stepId: input.step.id,
		},
	});

	return input.store.appendEvent({
		runId: input.runId,
		event: {
			type: "approval.requested",
			occurredAt: input.now(),
			approvalId: input.step.approvalId,
			stepId: input.step.id,
			...(input.step.message !== null ? { message: input.step.message } : {}),
		},
	});
}

function executeTerminalStep(input: {
	runId: string;
	step: Extract<RuntimeExecutionPlanStep, { kind: "terminal" }>;
	store: SQLiteRunStore;
	now: () => string;
}) {
	input.store.appendEvent({
		runId: input.runId,
		event: {
			type: "step.started",
			occurredAt: input.now(),
			stepId: input.step.id,
		},
	});
	input.store.appendEvent({
		runId: input.runId,
		event: {
			type: "step.completed",
			occurredAt: input.now(),
			stepId: input.step.id,
		},
	});
	return input.store.appendEvent({
		runId: input.runId,
		event: {
			type: "run.completed",
			occurredAt: input.now(),
		},
	});
}

function createShellCheckArtifactId(stepId: string) {
	return `shell-check:${stepId}`;
}

function normalizeExecutionError(error: unknown) {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message;
	}

	return "Persisted run execution failed unexpectedly.";
}

function failPersistedRunExecution(input: {
	runId: string;
	store: SQLiteRunStore;
	now: () => string;
	error: unknown;
}) {
	const existing = input.store.readRun(input.runId);
	if (!existing) {
		throw input.error;
	}
	if (
		existing.status !== "running" &&
		existing.status !== "waiting_for_approval"
	) {
		return existing;
	}

	const message = normalizeExecutionError(input.error);
	const activeStepId = existing.currentStepId;
	if (activeStepId) {
		input.store.appendEvent({
			runId: input.runId,
			event: {
				type: "step.failed",
				occurredAt: input.now(),
				stepId: activeStepId,
				message,
			},
		});
	}

	const latestRun = input.store.readRun(input.runId);
	if (!latestRun) {
		throw input.error;
	}
	if (
		latestRun.status !== "running" &&
		latestRun.status !== "waiting_for_approval"
	) {
		return latestRun;
	}

	return input.store.appendEvent({
		runId: input.runId,
		event: {
			type: "run.failed",
			occurredAt: input.now(),
			message,
		},
	});
}
