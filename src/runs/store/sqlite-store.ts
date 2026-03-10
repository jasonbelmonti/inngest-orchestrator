import { Database } from "bun:sqlite";
import { RunStoreError } from "./errors.ts";
import { RUN_STORE_SCHEMA, RUN_STORE_SCHEMA_VERSION } from "./schema.ts";
import {
	appendSequenceToEvent,
	applyRunEvent,
	createRunCreatedEvent,
} from "./projection.ts";
import type {
	CreateRunRecordInput,
	RunApprovalRequest,
	RunEventInput,
	RunProjectionRecord,
	StoredRunEvent,
} from "./types.ts";

interface OpenRunStoreOptions {
	databasePath?: string;
}

interface RunProjectionRow {
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

interface ApprovalRow {
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

interface ArtifactRow {
	artifact_id: string;
	run_id: string;
	step_id: string;
	kind: string;
	repo_id: string | null;
	relative_path: string;
	created_at: string;
	metadata_json: string | null;
}

interface EventRow {
	run_id: string;
	sequence: number;
	event_type: StoredRunEvent["type"];
	occurred_at: string;
	payload_json: string;
}

export class SQLiteRunStore {
	static open(options: OpenRunStoreOptions = {}) {
		const database = new Database(options.databasePath ?? ":memory:");
		const store = new SQLiteRunStore(database);
		store.initialize();
		store.rebuildProjections();
		return store;
	}

	private readonly createRunTransaction;
	private readonly appendEventTransaction;

	private constructor(private readonly database: Database) {
		this.createRunTransaction = this.database.transaction(
			(input: CreateRunRecordInput) => {
				if (this.readRun(input.runId)) {
					throw new RunStoreError({
						code: "run_store_conflict",
						message: `Run "${input.runId}" already exists.`,
					});
				}
				const event = createRunCreatedEvent(input);
				const nextState = applyRunEvent(null, event);
				this.insertRunEvent(event);
				this.writeProjection(nextState);
				return nextState;
			},
		);

		this.appendEventTransaction = this.database.transaction(
			(input: { runId: string; event: RunEventInput }) => {
				const current = this.readRun(input.runId);
				const sequence = (current?.latestEventSequence ?? 0) + 1;
				const event = appendSequenceToEvent({
					runId: input.runId,
					sequence,
					event: input.event,
				});
				const nextState = applyRunEvent(current, event);
				this.insertRunEvent(event);
				this.writeProjection(nextState);
				return nextState;
			},
		);
	}

	close() {
		this.database.close();
	}

	createRun(input: CreateRunRecordInput) {
		return this.createRunTransaction(input) as RunProjectionRecord;
	}

	appendEvent(input: { runId: string; event: RunEventInput }) {
		return this.appendEventTransaction(input) as RunProjectionRecord;
	}

	readRun(runId: string) {
		const row = this.database
			.query<RunProjectionRow, [string]>(
				`SELECT *
				FROM run_projections
				WHERE run_id = ?1`,
			)
			.get(runId);
		if (!row) {
			return null;
		}
		return this.mapRunProjection(row);
	}

	listRuns() {
		const rows = this.database
			.query<RunProjectionRow, []>(
				`SELECT *
				FROM run_projections
				ORDER BY updated_at DESC, run_id ASC`,
			)
			.all();
		return rows.map((row) => this.mapRunProjection(row));
	}

	listEvents(runId: string) {
		const rows = this.database
			.query<EventRow, [string]>(
				`SELECT *
				FROM run_events
				WHERE run_id = ?1
				ORDER BY sequence ASC`,
			)
			.all(runId);
		return rows.map((row) => this.mapStoredRunEvent(row));
	}

	rebuildProjections() {
		const rows = this.database
			.query<EventRow, []>(
				`SELECT *
				FROM run_events
				ORDER BY run_id ASC, sequence ASC`,
			)
			.all();
		const states = new Map<string, RunProjectionRecord>();
		for (const row of rows) {
			const event = this.mapStoredRunEvent(row);
			const current = states.get(event.runId) ?? null;
			states.set(event.runId, applyRunEvent(current, event));
		}

		const rebuildTransaction = this.database.transaction(() => {
			this.database.exec(`
				DELETE FROM run_projections;
				DELETE FROM approval_requests;
				DELETE FROM artifacts;
				DELETE FROM run_event_cursors;
			`);
			for (const state of states.values()) {
				this.writeProjection(state);
			}
		});

		rebuildTransaction();
	}

	private initialize() {
		this.database.exec("PRAGMA foreign_keys = ON;");
		this.database.exec(RUN_STORE_SCHEMA);
		this.database.exec(`PRAGMA user_version = ${RUN_STORE_SCHEMA_VERSION};`);
	}

	private insertRunEvent(event: StoredRunEvent) {
		const { runId, sequence, type, occurredAt, ...payload } = event;
		this.database
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
				runId,
				sequence,
				type,
				occurredAt,
				serializeJson(payload),
			);
	}

	private writeProjection(state: RunProjectionRecord) {
		this.database
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
				serializeJson(state.launch),
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

		this.database
			.query(`DELETE FROM approval_requests WHERE run_id = ?1`)
			.run(state.runId);
		this.database
			.query(`DELETE FROM artifacts WHERE run_id = ?1`)
			.run(state.runId);

		for (const approval of state.approvals) {
			this.database
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
			this.database
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
					artifact.metadata ? serializeJson(artifact.metadata) : null,
				);
		}

		this.database
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
			.run(state.runId, state.latestEventSequence, state.updatedAt);
	}

	private mapRunProjection(row: RunProjectionRow): RunProjectionRecord {
		const launch = parseJson<RunProjectionRecord["launch"]>(row.launch_json);
		const approvals = this.database
			.query<ApprovalRow, [string]>(
				`SELECT *
				FROM approval_requests
				WHERE run_id = ?1
				ORDER BY requested_at ASC, approval_id ASC`,
			)
			.all(row.run_id)
			.map((approval) => ({
				approvalId: approval.approval_id,
				runId: approval.run_id,
				stepId: approval.step_id,
				status: approval.status,
				requestedAt: approval.requested_at,
				respondedAt: approval.responded_at,
				decision: approval.decision,
				...(approval.message ? { message: approval.message } : {}),
				...(approval.comment ? { comment: approval.comment } : {}),
			}));
		const artifacts = this.database
			.query<ArtifactRow, [string]>(
				`SELECT *
				FROM artifacts
				WHERE run_id = ?1
				ORDER BY created_at ASC, artifact_id ASC`,
			)
			.all(row.run_id)
			.map((artifact) => ({
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
			}));
		return {
			runId: row.run_id,
			launch,
			status: row.status,
			currentStepId: row.current_step_id,
			latestEventSequence: row.latest_event_sequence,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			startedAt: row.started_at,
			completedAt: row.completed_at,
			failedAt: row.failed_at,
			cancelledAt: row.cancelled_at,
			failureMessage: row.failure_message,
			approvals,
			artifacts,
		};
	}

	private mapStoredRunEvent(row: EventRow): StoredRunEvent {
		const payload = parseJson<Record<string, unknown>>(row.payload_json);
		return {
			runId: row.run_id,
			sequence: row.sequence,
			type: row.event_type,
			occurredAt: row.occurred_at,
			...payload,
		} as StoredRunEvent;
	}
}

function serializeJson(value: unknown) {
	return JSON.stringify(value);
}

function parseJson<T>(value: string) {
	return JSON.parse(value) as T;
}
