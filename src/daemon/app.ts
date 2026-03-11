import type { SQLiteRunStore } from "../runs/store/sqlite-store.ts";
import { createDaemonFetchHandler } from "./routes.ts";

interface CreateDaemonAppOptions {
	store: SQLiteRunStore;
	generateRunId?: () => string;
	now?: () => string;
}

export function createDaemonApp(options: CreateDaemonAppOptions) {
	return {
		fetch: createDaemonFetchHandler({
			store: options.store,
			generateRunId: options.generateRunId ?? (() => crypto.randomUUID()),
			now: options.now ?? (() => new Date().toISOString()),
		}),
	};
}
