import type {
	RunApprovalRequest,
	RunArtifactRecord,
	RunProjectionRecord,
	StoredRunEvent,
} from "./types.ts";

export interface RunProjectionRow {
	run_id: string;
	launch_json: string;
	status: RunProjectionRecord["status"];
	current_step_id: string | null;
	latest_event_sequence: number;
	created_at: string;
	updated_at: string;
	started_at: string | null;
	completed_at: string | null;
	failed_at: string | null;
	cancelled_at: string | null;
	failure_message: string | null;
}

export interface ApprovalRow {
	approval_id: string;
	run_id: string;
	step_id: string;
	status: RunApprovalRequest["status"];
	requested_at: string;
	responded_at: string | null;
	decision: RunApprovalRequest["decision"];
	message: string | null;
	comment: string | null;
}

export interface ArtifactRow {
	artifact_id: string;
	run_id: string;
	step_id: string;
	kind: string;
	repo_id: string | null;
	relative_path: string;
	created_at: string;
	metadata_json: string | null;
}

export interface EventRow {
	run_id: string;
	sequence: number;
	event_type: StoredRunEvent["type"];
	occurred_at: string;
	payload_json: string;
}

export function mapRunProjectionRecord(input: {
	row: RunProjectionRow;
	approvals: ApprovalRow[];
	artifacts: ArtifactRow[];
}): RunProjectionRecord {
	const launch = parseJson<RunProjectionRecord["launch"]>(
		input.row.launch_json,
	);
	return {
		runId: input.row.run_id,
		launch,
		status: input.row.status,
		currentStepId: input.row.current_step_id,
		latestEventSequence: input.row.latest_event_sequence,
		createdAt: input.row.created_at,
		updatedAt: input.row.updated_at,
		startedAt: input.row.started_at,
		completedAt: input.row.completed_at,
		failedAt: input.row.failed_at,
		cancelledAt: input.row.cancelled_at,
		failureMessage: input.row.failure_message,
		approvals: input.approvals.map((approval) => ({
			approvalId: approval.approval_id,
			runId: approval.run_id,
			stepId: approval.step_id,
			status: approval.status,
			requestedAt: approval.requested_at,
			respondedAt: approval.responded_at,
			decision: approval.decision,
			...(approval.message !== null ? { message: approval.message } : {}),
			...(approval.comment !== null ? { comment: approval.comment } : {}),
		})),
		artifacts: input.artifacts.map((artifact) => ({
			artifactId: artifact.artifact_id,
			runId: artifact.run_id,
			stepId: artifact.step_id,
			kind: artifact.kind,
			repoId: artifact.repo_id,
			relativePath: artifact.relative_path,
			createdAt: artifact.created_at,
			metadata: artifact.metadata_json
				? parseJson<Record<string, unknown>>(artifact.metadata_json)
				: null,
		})),
	};
}

export function mapStoredRunEvent(row: EventRow): StoredRunEvent {
	const payload = parseJson<Record<string, unknown>>(row.payload_json);
	return {
		runId: row.run_id,
		sequence: row.sequence,
		type: row.event_type,
		occurredAt: row.occurred_at,
		...payload,
	} as StoredRunEvent;
}

export function serializeRunEventPayload(event: StoredRunEvent) {
	const { runId, sequence, type, occurredAt, ...payload } = event;
	return {
		runId,
		sequence,
		type,
		occurredAt,
		payloadJson: JSON.stringify(payload),
	};
}

export function serializeRunProjectionLaunch(
	launch: RunProjectionRecord["launch"],
) {
	return JSON.stringify(launch);
}

export function serializeArtifactMetadata(
	metadata: RunArtifactRecord["metadata"],
) {
	return metadata ? JSON.stringify(metadata) : null;
}

function parseJson<T>(value: string) {
	return JSON.parse(value) as T;
}
