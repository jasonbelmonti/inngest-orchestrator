import { serve } from "inngest/bun";
import { resolveDaemonDatabasePath } from "../daemon/config.ts";
import { SQLiteRunStore } from "../runs/store/index.ts";
import { executePersistedRun } from "../runtime/execute-run.ts";
import { RUNTIME_DISPATCH_EVENT, inngest } from "./client.ts";

interface RuntimeFunctionDependencies {
	openStore?: () => SQLiteRunStore;
	closeStore?: (store: SQLiteRunStore) => void;
	now?: () => string;
}

export function createPersistedRunExecutionFunction(
	dependencies: RuntimeFunctionDependencies = {},
) {
	const openStore = dependencies.openStore ?? defaultOpenStore;
	const closeStore =
		dependencies.closeStore ?? ((store: SQLiteRunStore) => store.close());
	const now = dependencies.now ?? (() => new Date().toISOString());

	return inngest.createFunction(
		{
			id: "execute-persisted-run",
			retries: 0,
		},
		{
			event: RUNTIME_DISPATCH_EVENT,
		},
		async ({ event }) => {
			const store = openStore();

			try {
				const run = await executePersistedRun({
					runId: event.data.runId,
					store,
					now,
				});

				return {
					runId: run.runId,
					status: run.status,
					latestEventSequence: run.latestEventSequence,
				};
			} finally {
				closeStore(store);
			}
		},
	);
}

export function createInngestHandler(
	dependencies: RuntimeFunctionDependencies = {},
) {
	return serve({
		client: inngest,
		functions: [createPersistedRunExecutionFunction(dependencies)],
	});
}

export const persistedRunExecutionFunction =
	createPersistedRunExecutionFunction();
export const inngestFunctions = [persistedRunExecutionFunction];
export const inngestHandler = serve({
	client: inngest,
	functions: inngestFunctions,
});

function defaultOpenStore() {
	return SQLiteRunStore.open({
		databasePath: resolveDaemonDatabasePath(),
	});
}
