import type { SQLiteRunStore } from "../runs/store/sqlite-store.ts";
import { executePersistedRun } from "../runtime/execute-run.ts";
import type { RuntimeDispatchFunction } from "./types.ts";

interface CreateLocalRuntimeDispatchOptions {
	store: SQLiteRunStore;
	now: () => string;
	onError?: (input: { runId: string; error: unknown }) => void;
}

export function createLocalRuntimeDispatch(
	options: CreateLocalRuntimeDispatchOptions,
): RuntimeDispatchFunction {
	return ({ runId }) => {
		queueMicrotask(async () => {
			try {
				await executePersistedRun({
					runId,
					store: options.store,
					now: options.now,
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
