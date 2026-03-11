import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { SQLiteRunStore } from "./runs/store/sqlite-store.ts";
import { createDaemonApp } from "./daemon/app.ts";
import { resolveDaemonRuntimeConfig } from "./daemon/config.ts";

const config = resolveDaemonRuntimeConfig();

await mkdir(dirname(config.databasePath), { recursive: true });

const store = SQLiteRunStore.open({ databasePath: config.databasePath });
const app = createDaemonApp({ store });

const server = Bun.serve({
	hostname: config.host,
	port: config.port,
	fetch: app.fetch,
});

console.log(
	`inngest-orchestrator daemon listening on http://${config.host}:${config.port} using ${config.databasePath}`,
);

registerShutdownHandler(server, store);

function registerShutdownHandler(
	daemon: ReturnType<typeof Bun.serve>,
	runStore: SQLiteRunStore,
) {
	let closed = false;

	const close = () => {
		if (closed) {
			return;
		}
		closed = true;
		daemon.stop(true);
		runStore.close();
	};

	process.on("SIGINT", close);
	process.on("SIGTERM", close);
}
