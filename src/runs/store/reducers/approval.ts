import { RunStoreError } from "../errors.ts";
import type {
	RunApprovalRequest,
	RunProjectionRecord,
	StoredRunEvent,
} from "../types.ts";
import { assertRunState, assertRunStatus } from "./shared.ts";

export function reduceApprovalRequested(
	state: RunProjectionRecord | null,
	event: Extract<StoredRunEvent, { type: "approval.requested" }>,
): RunProjectionRecord {
	const existing = assertRunState(state, event.runId);
	assertRunStatus(existing, ["running"], event.type);
	if (existing.currentStepId !== event.stepId) {
		throw new RunStoreError({
			code: "run_store_invalid_transition",
			message: `Approval "${event.approvalId}" must target the active step for run "${event.runId}".`,
		});
	}
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

export function reduceApprovalResolved(
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
