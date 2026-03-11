import { resolve } from "node:path";

export interface DaemonRuntimeConfig {
	host: string;
	port: number;
	databasePath: string;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3017;
const DEFAULT_DATABASE_PATH = resolve(
	import.meta.dir,
	"../../.local/inngest-orchestrator.sqlite",
);

export function resolveDaemonRuntimeConfig(
	env: NodeJS.ProcessEnv = process.env,
): DaemonRuntimeConfig {
	return {
		host: env.INGGEST_ORCHESTRATOR_HOST || DEFAULT_HOST,
		port: parsePort(env.INGGEST_ORCHESTRATOR_PORT),
		databasePath: env.INGGEST_ORCHESTRATOR_DB_PATH || DEFAULT_DATABASE_PATH,
	};
}

function parsePort(input: string | undefined) {
	if (!input) {
		return DEFAULT_PORT;
	}

	const value = Number.parseInt(input, 10);
	if (Number.isNaN(value) || value <= 0) {
		throw new Error(
			`INGGEST_ORCHESTRATOR_PORT must be a positive integer. Received "${input}".`,
		);
	}

	return value;
}
