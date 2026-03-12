import { inngestHandler } from "../inngest/functions.ts";
import { dispatchPersistedRun } from "../inngest/client.ts";
import type { SQLiteRunStore } from "../runs/store/sqlite-store.ts";
import { createDaemonFetchHandler } from "./routes.ts";
import { RunEventStreamBroker } from "./sse.ts";
import type { DaemonRequestHandler, RuntimeDispatchFunction } from "./types.ts";

interface CreateDaemonAppOptions {
	store: SQLiteRunStore;
	eventStreamBroker?: RunEventStreamBroker;
	generateRunId?: () => string;
	now?: () => string;
	dispatchRun?: RuntimeDispatchFunction;
	inngestHandler?: DaemonRequestHandler;
}

export function createDaemonApp(options: CreateDaemonAppOptions) {
	const eventStreamBroker =
		options.eventStreamBroker ?? new RunEventStreamBroker();

	return {
		fetch: createDaemonFetchHandler({
			store: options.store,
			eventStreamBroker,
			generateRunId: options.generateRunId ?? (() => crypto.randomUUID()),
			now: options.now ?? (() => new Date().toISOString()),
			dispatchRun: options.dispatchRun ?? dispatchPersistedRun,
			inngestHandler: options.inngestHandler ?? inngestHandler,
		}),
	};
}
