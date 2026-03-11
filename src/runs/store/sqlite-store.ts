import { Database } from "bun:sqlite";
import { RunStoreError } from "./errors.ts";
import {
	appendSequenceToEvent,
	applyRunEvent,
	createRunCreatedEvent,
} from "./projection.ts";
import {
	initializeRunStore,
	insertRunEvent,
	listRunProjections,
	listStoredRunEvents,
	readAllStoredRunEvents,
	readRunEventCursor,
	readRunProjection,
	resetDerivedRunState,
	writeRunEventCursor,
	writeRunProjection,
} from "./persistence.ts";
import type {
	CreateRunRecordInput,
	CreateStartedRunRecordInput,
	RunEventInput,
	RunProjectionRecord,
} from "./types.ts";

interface OpenRunStoreOptions {
	databasePath?: string;
}

export class SQLiteRunStore {
	static open(options: OpenRunStoreOptions = {}) {
		const database = new Database(options.databasePath ?? ":memory:");
		const store = new SQLiteRunStore(database);
		initializeRunStore(database);
		store.rebuildProjections();
		return store;
	}

	private readonly createRunTransaction;
	private readonly createStartedRunTransaction;
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
				insertRunEvent(this.database, event);
				writeRunProjection(this.database, nextState);
				return nextState;
			},
		);

		this.createStartedRunTransaction = this.database.transaction(
			(input: CreateStartedRunRecordInput) => {
				if (this.readRun(input.runId)) {
					throw new RunStoreError({
						code: "run_store_conflict",
						message: `Run "${input.runId}" already exists.`,
					});
				}
				const createdEvent = createRunCreatedEvent(input);
				const startedEvent = appendSequenceToEvent({
					runId: input.runId,
					sequence: 2,
					event: {
						type: "run.started",
						occurredAt: input.startedAt,
					},
				});

				let nextState = applyRunEvent(null, createdEvent);
				insertRunEvent(this.database, createdEvent);

				nextState = applyRunEvent(nextState, startedEvent);
				insertRunEvent(this.database, startedEvent);
				writeRunProjection(this.database, nextState);
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
				insertRunEvent(this.database, event);
				writeRunProjection(this.database, nextState);
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

	createStartedRun(input: CreateStartedRunRecordInput) {
		return this.createStartedRunTransaction(input) as RunProjectionRecord;
	}

	appendEvent(input: { runId: string; event: RunEventInput }) {
		return this.appendEventTransaction(input) as RunProjectionRecord;
	}

	readRun(runId: string) {
		return readRunProjection(this.database, runId);
	}

	listRuns() {
		return listRunProjections(this.database);
	}

	listEvents(runId: string) {
		return listStoredRunEvents(this.database, runId);
	}

	readCursor(runId: string) {
		return readRunEventCursor(this.database, runId);
	}

	saveCursor(input: {
		runId: string;
		lastEventSequence: number;
		updatedAt: string;
	}) {
		writeRunEventCursor(this.database, input);
	}

	rebuildProjections() {
		const states = new Map<string, RunProjectionRecord>();
		for (const event of readAllStoredRunEvents(this.database)) {
			const current = states.get(event.runId) ?? null;
			states.set(event.runId, applyRunEvent(current, event));
		}

		const rebuildTransaction = this.database.transaction(() => {
			resetDerivedRunState(this.database);
			for (const state of states.values()) {
				writeRunProjection(this.database, state);
			}
		});

		rebuildTransaction();
	}
}
