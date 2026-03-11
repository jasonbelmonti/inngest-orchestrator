import type { Database } from "bun:sqlite";
import { RUN_STORE_SCHEMA, RUN_STORE_SCHEMA_VERSION } from "./schema.ts";
import {
	mapRunProjectionRecord,
	mapStoredRunEvent,
	serializeArtifactMetadata,
	serializeRunEventPayload,
	serializeRunProjectionLaunch,
	type ApprovalRow,
	type ArtifactRow,
	type EventRow,
	type RunProjectionRow,
} from "./mapping.ts";
import type { RunProjectionRecord, StoredRunEvent } from "./types.ts";

interface RunEventCursorRow {
	run_id: string;
	last_event_sequence: number;
	updated_at: string;
}

export function initializeRunStore(database: Database) {
	database.exec("PRAGMA foreign_keys = ON;");
	database.exec(RUN_STORE_SCHEMA);
	database.exec(`PRAGMA user_version = ${RUN_STORE_SCHEMA_VERSION};`);
}

export function readRunProjection(database: Database, runId: string) {
	const row = database
		.query<RunProjectionRow, [string]>(
			`SELECT *
			FROM run_projections
			WHERE run_id = ?1`,
		)
		.get(runId);
	if (!row) {
		return null;
	}
	return mapRunProjectionRecord({
		row,
		approvals: readApprovalRows(database, runId),
		artifacts: readArtifactRows(database, runId),
	});
}

export function listRunProjections(database: Database) {
	const rows = database
		.query<RunProjectionRow, []>(
			`SELECT *
			FROM run_projections
			ORDER BY updated_at DESC, run_id ASC`,
		)
		.all();
	return rows.map((row) =>
		mapRunProjectionRecord({
			row,
			approvals: readApprovalRows(database, row.run_id),
			artifacts: readArtifactRows(database, row.run_id),
		}),
	);
}

export function listStoredRunEvents(database: Database, runId: string) {
	const rows = database
		.query<EventRow, [string]>(
			`SELECT *
			FROM run_events
			WHERE run_id = ?1
			ORDER BY sequence ASC`,
		)
		.all(runId);
	return rows.map((row) => mapStoredRunEvent(row));
}

export function readAllStoredRunEvents(database: Database) {
	const rows = database
		.query<EventRow, []>(
			`SELECT *
			FROM run_events
			ORDER BY run_id ASC, sequence ASC`,
		)
		.all();
	return rows.map((row) => mapStoredRunEvent(row));
}

export function readRunEventCursor(database: Database, runId: string) {
	const row = database
		.query<RunEventCursorRow, [string]>(
			`SELECT *
			FROM run_event_cursors
			WHERE run_id = ?1`,
		)
		.get(runId);
	if (!row) {
		return null;
	}
	return {
		runId: row.run_id,
		lastEventSequence: row.last_event_sequence,
		updatedAt: row.updated_at,
	};
}

export function writeRunEventCursor(
	database: Database,
	input: { runId: string; lastEventSequence: number; updatedAt: string },
) {
	database
		.query(
			`INSERT INTO run_event_cursors (
				run_id,
				last_event_sequence,
				updated_at
			) VALUES (?1, ?2, ?3)
			ON CONFLICT(run_id) DO UPDATE SET
				last_event_sequence = excluded.last_event_sequence,
				updated_at = excluded.updated_at`,
		)
		.run(input.runId, input.lastEventSequence, input.updatedAt);
}

export function insertRunEvent(database: Database, event: StoredRunEvent) {
	const serialized = serializeRunEventPayload(event);
	database
		.query(
			`INSERT INTO run_events (
				run_id,
				sequence,
				event_type,
				occurred_at,
				payload_json
			) VALUES (?1, ?2, ?3, ?4, ?5)`,
		)
		.run(
			serialized.runId,
			serialized.sequence,
			serialized.type,
			serialized.occurredAt,
			serialized.payloadJson,
		);
}

export function writeRunProjection(
	database: Database,
	state: RunProjectionRecord,
) {
	database
		.query(
			`INSERT INTO run_projections (
				run_id,
				config_root,
				workflow_id,
				workflow_name,
				workflow_summary,
				workflow_content_hash,
				workflow_file_path,
				launch_json,
				status,
				current_step_id,
				latest_event_sequence,
				created_at,
				updated_at,
				started_at,
				completed_at,
				failed_at,
				cancelled_at,
				failure_message
			) VALUES (
				?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18
			)
			ON CONFLICT(run_id) DO UPDATE SET
				config_root = excluded.config_root,
				workflow_id = excluded.workflow_id,
				workflow_name = excluded.workflow_name,
				workflow_summary = excluded.workflow_summary,
				workflow_content_hash = excluded.workflow_content_hash,
				workflow_file_path = excluded.workflow_file_path,
				launch_json = excluded.launch_json,
				status = excluded.status,
				current_step_id = excluded.current_step_id,
				latest_event_sequence = excluded.latest_event_sequence,
				created_at = excluded.created_at,
				updated_at = excluded.updated_at,
				started_at = excluded.started_at,
				completed_at = excluded.completed_at,
				failed_at = excluded.failed_at,
				cancelled_at = excluded.cancelled_at,
				failure_message = excluded.failure_message`,
		)
		.run(
			state.runId,
			state.launch.configRoot,
			state.launch.workflow.workflowId,
			state.launch.workflow.name,
			state.launch.workflow.summary ?? null,
			state.launch.workflow.contentHash,
			state.launch.workflow.filePath,
			serializeRunProjectionLaunch(state.launch),
			state.status,
			state.currentStepId,
			state.latestEventSequence,
			state.createdAt,
			state.updatedAt,
			state.startedAt,
			state.completedAt,
			state.failedAt,
			state.cancelledAt,
			state.failureMessage,
		);

	database.query(`DELETE FROM approval_requests WHERE run_id = ?1`).run(state.runId);
	database.query(`DELETE FROM artifacts WHERE run_id = ?1`).run(state.runId);

	for (const approval of state.approvals) {
		database
			.query(
				`INSERT INTO approval_requests (
					approval_id,
					run_id,
					step_id,
					status,
					requested_at,
					responded_at,
					decision,
					message,
					comment
				) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
			)
			.run(
				approval.approvalId,
				approval.runId,
				approval.stepId,
				approval.status,
				approval.requestedAt,
				approval.respondedAt,
				approval.decision,
				approval.message ?? null,
				approval.comment ?? null,
			);
	}

	for (const artifact of state.artifacts) {
		database
			.query(
				`INSERT INTO artifacts (
					artifact_id,
					run_id,
					step_id,
					kind,
					repo_id,
					relative_path,
					created_at,
					metadata_json
				) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
			)
			.run(
				artifact.artifactId,
				artifact.runId,
				artifact.stepId,
				artifact.kind,
				artifact.repoId,
				artifact.relativePath,
				artifact.createdAt,
				serializeArtifactMetadata(artifact.metadata),
			);
	}
}

export function resetDerivedRunState(database: Database) {
	database.exec(`
		DELETE FROM run_projections;
		DELETE FROM approval_requests;
		DELETE FROM artifacts;
	`);
}

function readApprovalRows(database: Database, runId: string) {
	return database
		.query<ApprovalRow, [string]>(
			`SELECT *
			FROM approval_requests
			WHERE run_id = ?1
			ORDER BY requested_at ASC, approval_id ASC`,
		)
		.all(runId);
}

function readArtifactRows(database: Database, runId: string) {
	return database
		.query<ArtifactRow, [string]>(
			`SELECT *
			FROM artifacts
			WHERE run_id = ?1
			ORDER BY created_at ASC, artifact_id ASC`,
		)
		.all(runId);
}
