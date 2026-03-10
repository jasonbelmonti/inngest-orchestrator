import type {
	CreateRunRecordInput,
	RunEventInput,
	RunProjectionRecord,
	StoredRunEvent,
} from "./types.ts";
import {
	reduceRunCancelled,
	reduceRunCompleted,
	reduceRunCreated,
	reduceRunFailed,
	reduceRunStarted,
	reduceStepCompleted,
	reduceStepFailed,
	reduceStepStarted,
} from "./reducers/lifecycle.ts";
import {
	reduceApprovalRequested,
	reduceApprovalResolved,
} from "./reducers/approval.ts";
import { reduceArtifactCreated } from "./reducers/artifact.ts";

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
