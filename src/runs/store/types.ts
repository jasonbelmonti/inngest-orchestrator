import type { ResolvedRunLaunchRequest } from "../types.ts";

export type RunStatus =
	| "created"
	| "running"
	| "waiting_for_approval"
	| "completed"
	| "failed"
	| "cancelled";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface CreateRunRecordInput {
	runId: string;
	createdAt: string;
	launch: ResolvedRunLaunchRequest;
}

export interface CreateStartedRunRecordInput extends CreateRunRecordInput {
	startedAt: string;
}

export type RunEventInput =
	| {
			type: "run.started";
			occurredAt: string;
	  }
	| {
			type: "step.started";
			occurredAt: string;
			stepId: string;
	  }
	| {
			type: "step.completed";
			occurredAt: string;
			stepId: string;
	  }
	| {
			type: "step.failed";
			occurredAt: string;
			stepId: string;
			message: string;
	  }
	| {
			type: "approval.requested";
			occurredAt: string;
			approvalId: string;
			stepId: string;
			message?: string;
	  }
	| {
			type: "approval.resolved";
			occurredAt: string;
			approvalId: string;
			decision: Exclude<ApprovalStatus, "pending">;
			comment?: string;
	  }
	| {
			type: "artifact.created";
			occurredAt: string;
			artifactId: string;
			stepId: string;
			kind: string;
			repoId?: string;
			relativePath: string;
			metadata?: Record<string, unknown>;
	  }
	| {
			type: "run.completed";
			occurredAt: string;
	  }
	| {
			type: "run.failed";
			occurredAt: string;
			message: string;
	  }
	| {
			type: "run.cancelled";
			occurredAt: string;
			reason?: string;
	  };

export type StoredRunEvent =
	| {
			runId: string;
			sequence: number;
			type: "run.created";
			occurredAt: string;
			launch: ResolvedRunLaunchRequest;
	  }
	| ({
			runId: string;
			sequence: number;
	  } & RunEventInput);

export interface RunApprovalRequest {
	approvalId: string;
	runId: string;
	stepId: string;
	status: ApprovalStatus;
	requestedAt: string;
	respondedAt: string | null;
	decision: Exclude<ApprovalStatus, "pending"> | null;
	message?: string;
	comment?: string;
}

export interface RunArtifactRecord {
	artifactId: string;
	runId: string;
	stepId: string;
	kind: string;
	repoId: string | null;
	relativePath: string;
	createdAt: string;
	metadata: Record<string, unknown> | null;
}

export interface RunProjectionRecord {
	runId: string;
	launch: ResolvedRunLaunchRequest;
	status: RunStatus;
	currentStepId: string | null;
	latestEventSequence: number;
	createdAt: string;
	updatedAt: string;
	startedAt: string | null;
	completedAt: string | null;
	failedAt: string | null;
	cancelledAt: string | null;
	failureMessage: string | null;
	approvals: RunApprovalRequest[];
	artifacts: RunArtifactRecord[];
}
