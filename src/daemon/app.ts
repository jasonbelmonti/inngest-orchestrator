import type { SQLiteRunStore } from "../runs/store/sqlite-store.ts";
import { createDaemonFetchHandler } from "./routes.ts";
import { RunEventStreamBroker } from "./sse.ts";

interface CreateDaemonAppOptions {
	store: SQLiteRunStore;
	eventStreamBroker?: RunEventStreamBroker;
	generateRunId?: () => string;
	now?: () => string;
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
		}),
	};
}
