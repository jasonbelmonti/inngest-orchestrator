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
			const startingSequence =
				options.store.readRun(runId)?.latestEventSequence ?? 0;

			try {
				await executePersistedRun({
					runId,
					store: options.store,
					now: options.now,
				});
				publishRuntimeEvents({
					runId,
					afterSequence: startingSequence,
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

function publishRuntimeEvents(input: {
	runId: string;
	afterSequence: number;
	store: SQLiteRunStore;
	eventStreamBroker: RunEventStreamBroker;
}) {
	if (input.eventStreamBroker.subscriberCount(input.runId) === 0) {
		return;
	}

	const events = input.store.listEventsAfter({
		runId: input.runId,
		afterSequence: input.afterSequence,
	});
	if (events.length === 0) {
		return;
	}

	input.eventStreamBroker.publish(input.runId, events);
}
