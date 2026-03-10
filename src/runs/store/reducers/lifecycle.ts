import { RunStoreError } from "../errors.ts";
import type { RunProjectionRecord, StoredRunEvent } from "../types.ts";
import { assertRunState, assertRunStatus } from "./shared.ts";

export function reduceRunCreated(
	state: RunProjectionRecord | null,
	event: Extract<StoredRunEvent, { type: "run.created" }>,
): RunProjectionRecord {
	if (state) {
		throw new RunStoreError({
			code: "run_store_conflict",
			message: `Run "${event.runId}" already exists.`,
		});
	}

	return {
		runId: event.runId,
		launch: event.launch,
		status: "created",
		currentStepId: null,
		latestEventSequence: event.sequence,
		createdAt: event.occurredAt,
		updatedAt: event.occurredAt,
		startedAt: null,
		completedAt: null,
		failedAt: null,
		cancelledAt: null,
		failureMessage: null,
		approvals: [],
		artifacts: [],
	};
}

export function reduceRunStarted(
	state: RunProjectionRecord | null,
	event: Extract<StoredRunEvent, { type: "run.started" }>,
): RunProjectionRecord {
	const existing = assertRunState(state, event.runId);
	assertRunStatus(existing, ["created"], event.type);
	return {
		...existing,
		status: "running",
		startedAt: event.occurredAt,
		updatedAt: event.occurredAt,
		latestEventSequence: event.sequence,
	};
}

export function reduceStepStarted(
	state: RunProjectionRecord | null,
	event: Extract<StoredRunEvent, { type: "step.started" }>,
): RunProjectionRecord {
	const existing = assertRunState(state, event.runId);
	assertRunStatus(existing, ["running"], event.type);
	if (existing.currentStepId !== null) {
		throw new RunStoreError({
			code: "run_store_invalid_transition",
			message: `Run "${event.runId}" already has active step "${existing.currentStepId}".`,
		});
	}
	return {
		...existing,
		currentStepId: event.stepId,
		updatedAt: event.occurredAt,
		latestEventSequence: event.sequence,
	};
}

export function reduceStepCompleted(
	state: RunProjectionRecord | null,
	event: Extract<StoredRunEvent, { type: "step.completed" }>,
): RunProjectionRecord {
	const existing = assertRunState(state, event.runId);
	assertRunStatus(existing, ["running"], event.type);
	if (existing.currentStepId !== event.stepId) {
		throw new RunStoreError({
			code: "run_store_invalid_transition",
			message: `Step "${event.stepId}" is not the active step for run "${event.runId}".`,
		});
	}
	return {
		...existing,
		currentStepId: null,
		updatedAt: event.occurredAt,
		latestEventSequence: event.sequence,
	};
}

export function reduceStepFailed(
	state: RunProjectionRecord | null,
	event: Extract<StoredRunEvent, { type: "step.failed" }>,
): RunProjectionRecord {
	const existing = assertRunState(state, event.runId);
	assertRunStatus(existing, ["running"], event.type);
	if (existing.currentStepId !== event.stepId) {
		throw new RunStoreError({
			code: "run_store_invalid_transition",
			message: `Step "${event.stepId}" is not the active step for run "${event.runId}".`,
		});
	}
	return {
		...existing,
		currentStepId: null,
		updatedAt: event.occurredAt,
		latestEventSequence: event.sequence,
		failureMessage: event.message,
	};
}

export function reduceRunCompleted(
	state: RunProjectionRecord | null,
	event: Extract<StoredRunEvent, { type: "run.completed" }>,
): RunProjectionRecord {
	const existing = assertRunState(state, event.runId);
	assertRunStatus(existing, ["running"], event.type);
	return {
		...existing,
		status: "completed",
		currentStepId: null,
		completedAt: event.occurredAt,
		updatedAt: event.occurredAt,
		latestEventSequence: event.sequence,
	};
}

export function reduceRunFailed(
	state: RunProjectionRecord | null,
	event: Extract<StoredRunEvent, { type: "run.failed" }>,
): RunProjectionRecord {
	const existing = assertRunState(state, event.runId);
	assertRunStatus(existing, ["running", "waiting_for_approval"], event.type);
	return {
		...existing,
		status: "failed",
		currentStepId: null,
		failedAt: event.occurredAt,
		failureMessage: event.message,
		updatedAt: event.occurredAt,
		latestEventSequence: event.sequence,
	};
}

export function reduceRunCancelled(
	state: RunProjectionRecord | null,
	event: Extract<StoredRunEvent, { type: "run.cancelled" }>,
): RunProjectionRecord {
	const existing = assertRunState(state, event.runId);
	assertRunStatus(
		existing,
		["created", "running", "waiting_for_approval"],
		event.type,
	);
	return {
		...existing,
		status: "cancelled",
		currentStepId: null,
		cancelledAt: event.occurredAt,
		failureMessage: event.reason ?? existing.failureMessage,
		updatedAt: event.occurredAt,
		latestEventSequence: event.sequence,
	};
}
