import { inngestHandler } from "../inngest/functions.ts";
import type { SQLiteRunStore } from "../runs/store/sqlite-store.ts";
import { createDaemonFetchHandler } from "./routes.ts";
import { createLocalRuntimeDispatch } from "./runtime-dispatch.ts";
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
	const now = options.now ?? (() => new Date().toISOString());

	return {
		fetch: createDaemonFetchHandler({
			store: options.store,
			eventStreamBroker,
			generateRunId: options.generateRunId ?? (() => crypto.randomUUID()),
			now,
			dispatchRun:
				options.dispatchRun ??
				createLocalRuntimeDispatch({
					store: options.store,
					eventStreamBroker,
					now,
				}),
			inngestHandler: options.inngestHandler ?? inngestHandler,
		}),
	};
}
