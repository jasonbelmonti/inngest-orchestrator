import type { SQLiteRunStore } from "../runs/store/sqlite-store.ts";
import { executePersistedRun } from "../runtime/execute-run.ts";
import type { RunEventStreamBroker } from "./sse.ts";
import type { RuntimeDispatchFunction } from "./types.ts";

interface CreateLocalRuntimeDispatchOptions {
	store: SQLiteRunStore;
	eventStreamBroker: RunEventStreamBroker;
	now: () => string;
	onError?: (input: { runId: string; error: unknown }) => void;
}

export function createLocalRuntimeDispatch(
	options: CreateLocalRuntimeDispatchOptions,
): RuntimeDispatchFunction {
	return ({ runId }) => {
		queueMicrotask(async () => {
			const publishedSequences: number[] = [];

			try {
				await executePersistedRun({
					runId,
					store: createTrackedRunStore(options.store, publishedSequences),
					now: options.now,
				});
				publishRuntimeEvents({
					runId,
					sequences: publishedSequences,
					store: options.store,
					eventStreamBroker: options.eventStreamBroker,
				});
			} catch (error) {
				options.onError?.({ runId, error });
				console.error(
					`Persisted run "${runId}" failed during local runtime dispatch.`,
					error,
				);
			}
		});
	};
}

function createTrackedRunStore(
	store: SQLiteRunStore,
	publishedSequences: number[],
) {
	return {
		close: store.close.bind(store),
		createRun: store.createRun.bind(store),
		createStartedRun: store.createStartedRun.bind(store),
		appendEvent: (input: Parameters<SQLiteRunStore["appendEvent"]>[0]) => {
			const run = store.appendEvent(input);
			publishedSequences.push(run.latestEventSequence);
			return run;
		},
		readRun: store.readRun.bind(store),
		listRuns: store.listRuns.bind(store),
		listEvents: store.listEvents.bind(store),
		listEventsAfter: store.listEventsAfter.bind(store),
		readEvent: store.readEvent.bind(store),
		readCursor: store.readCursor.bind(store),
		saveCursor: store.saveCursor.bind(store),
		rebuildProjections: store.rebuildProjections.bind(store),
	} as SQLiteRunStore;
}

function publishRuntimeEvents(input: {
	runId: string;
	sequences: number[];
	store: SQLiteRunStore;
	eventStreamBroker: RunEventStreamBroker;
}) {
	if (input.eventStreamBroker.subscriberCount(input.runId) === 0) {
		return;
	}

	const events = input.sequences
		.map((sequence) => input.store.readEvent({ runId: input.runId, sequence }))
		.filter((event) => event !== null);
	if (events.length === 0) {
		return;
	}

	input.eventStreamBroker.publish(input.runId, events);
}
