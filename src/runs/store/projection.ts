import { RunStoreError } from "./errors.ts";
import type {
	CreateRunRecordInput,
	RunApprovalRequest,
	RunArtifactRecord,
	RunEventInput,
	RunProjectionRecord,
	StoredRunEvent,
} from "./types.ts";

export function createRunCreatedEvent(input: CreateRunRecordInput): StoredRunEvent {
	return {
		runId: input.runId,
		sequence: 1,
		type: "run.created",
		occurredAt: input.createdAt,
		launch: input.launch,
	};
}

export function appendSequenceToEvent(input: {
	runId: string;
	sequence: number;
	event: RunEventInput;
}): StoredRunEvent {
	return {
		runId: input.runId,
		sequence: input.sequence,
		...input.event,
	};
}

export function applyRunEvent(
	state: RunProjectionRecord | null,
	event: StoredRunEvent,
): RunProjectionRecord {
	switch (event.type) {
		case "run.created":
			return reduceRunCreated(state, event);
		case "run.started":
			return reduceRunStarted(state, event);
		case "step.started":
			return reduceStepStarted(state, event);
		case "step.completed":
			return reduceStepCompleted(state, event);
		case "step.failed":
			return reduceStepFailed(state, event);
		case "approval.requested":
			return reduceApprovalRequested(state, event);
		case "approval.resolved":
			return reduceApprovalResolved(state, event);
		case "artifact.created":
			return reduceArtifactCreated(state, event);
		case "run.completed":
			return reduceRunCompleted(state, event);
		case "run.failed":
			return reduceRunFailed(state, event);
		case "run.cancelled":
			return reduceRunCancelled(state, event);
	}
}

function reduceRunCreated(
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

function reduceRunStarted(
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

function reduceStepStarted(
	state: RunProjectionRecord | null,
	event: Extract<StoredRunEvent, { type: "step.started" }>,
): RunProjectionRecord {
	const existing = assertRunState(state, event.runId);
	assertRunStatus(existing, ["running"], event.type);
	return {
		...existing,
		currentStepId: event.stepId,
		updatedAt: event.occurredAt,
		latestEventSequence: event.sequence,
	};
}

function reduceStepCompleted(
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

function reduceStepFailed(
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

function reduceApprovalRequested(
	state: RunProjectionRecord | null,
	event: Extract<StoredRunEvent, { type: "approval.requested" }>,
): RunProjectionRecord {
	const existing = assertRunState(state, event.runId);
	assertRunStatus(existing, ["running"], event.type);
	if (existing.approvals.some((approval) => approval.status === "pending")) {
		throw new RunStoreError({
			code: "run_store_invalid_transition",
			message: `Run "${event.runId}" already has a pending approval.`,
		});
	}
	if (existing.approvals.some((approval) => approval.approvalId === event.approvalId)) {
		throw new RunStoreError({
			code: "run_store_conflict",
			message: `Approval "${event.approvalId}" already exists for run "${event.runId}".`,
		});
	}
	const approval: RunApprovalRequest = {
		approvalId: event.approvalId,
		runId: event.runId,
		stepId: event.stepId,
		status: "pending",
		requestedAt: event.occurredAt,
		respondedAt: null,
		decision: null,
		...(event.message ? { message: event.message } : {}),
	};
	return {
		...existing,
		status: "waiting_for_approval",
		currentStepId: event.stepId,
		updatedAt: event.occurredAt,
		latestEventSequence: event.sequence,
		approvals: [...existing.approvals, approval],
	};
}

function reduceApprovalResolved(
	state: RunProjectionRecord | null,
	event: Extract<StoredRunEvent, { type: "approval.resolved" }>,
): RunProjectionRecord {
	const existing = assertRunState(state, event.runId);
	assertRunStatus(existing, ["waiting_for_approval"], event.type);
	const approval = existing.approvals.find(
		(candidate) => candidate.approvalId === event.approvalId,
	);
	if (!approval) {
		throw new RunStoreError({
			code: "run_store_not_found",
			message: `Approval "${event.approvalId}" was not found for run "${event.runId}".`,
		});
	}
	if (approval.status !== "pending") {
		throw new RunStoreError({
			code: "run_store_invalid_transition",
			message: `Approval "${event.approvalId}" is already resolved.`,
		});
	}
	return {
		...existing,
		status: "running",
		updatedAt: event.occurredAt,
		latestEventSequence: event.sequence,
		approvals: existing.approvals.map((candidate) =>
			candidate.approvalId === event.approvalId
				? {
						...candidate,
						status: event.decision,
						decision: event.decision,
						respondedAt: event.occurredAt,
						...(event.comment ? { comment: event.comment } : {}),
				  }
				: candidate,
		),
	};
}

function reduceArtifactCreated(
	state: RunProjectionRecord | null,
	event: Extract<StoredRunEvent, { type: "artifact.created" }>,
): RunProjectionRecord {
	const existing = assertRunState(state, event.runId);
	assertRunStatus(
		existing,
		["running", "waiting_for_approval", "completed", "failed", "cancelled"],
		event.type,
	);
	if (existing.artifacts.some((artifact) => artifact.artifactId === event.artifactId)) {
		throw new RunStoreError({
			code: "run_store_conflict",
			message: `Artifact "${event.artifactId}" already exists for run "${event.runId}".`,
		});
	}
	const artifact: RunArtifactRecord = {
		artifactId: event.artifactId,
		runId: event.runId,
		stepId: event.stepId,
		kind: event.kind,
		repoId: event.repoId ?? null,
		relativePath: event.relativePath,
		createdAt: event.occurredAt,
		metadata: event.metadata ?? null,
	};
	return {
		...existing,
		updatedAt: event.occurredAt,
		latestEventSequence: event.sequence,
		artifacts: [...existing.artifacts, artifact],
	};
}

function reduceRunCompleted(
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

function reduceRunFailed(
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

function reduceRunCancelled(
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

function assertRunState(state: RunProjectionRecord | null, runId: string) {
	if (!state) {
		throw new RunStoreError({
			code: "run_store_not_found",
			message: `Run "${runId}" was not found.`,
		});
	}
	return state;
}

function assertRunStatus(
	state: RunProjectionRecord,
	allowedStatuses: RunProjectionRecord["status"][],
	eventType: StoredRunEvent["type"],
) {
	if (allowedStatuses.includes(state.status)) {
		return;
	}
	throw new RunStoreError({
		code: "run_store_invalid_transition",
		message: `Cannot apply "${eventType}" while run "${state.runId}" is "${state.status}".`,
	});
}
