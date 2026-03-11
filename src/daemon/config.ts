import { resolve } from "node:path";

export interface DaemonRuntimeConfig {
	host: string;
	port: number;
	databasePath: string;
	idleTimeoutSeconds: number;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3017;
const DEFAULT_IDLE_TIMEOUT_SECONDS = 120;
const DEFAULT_DATABASE_PATH = resolve(
	import.meta.dir,
	"../../.local/inngest-orchestrator.sqlite",
);

export function resolveDaemonRuntimeConfig(
	env: NodeJS.ProcessEnv = process.env,
): DaemonRuntimeConfig {
	return {
		host: env.INNGEST_ORCHESTRATOR_HOST || DEFAULT_HOST,
		port: parsePort(env.INNGEST_ORCHESTRATOR_PORT),
		databasePath: env.INNGEST_ORCHESTRATOR_DB_PATH || DEFAULT_DATABASE_PATH,
		idleTimeoutSeconds: DEFAULT_IDLE_TIMEOUT_SECONDS,
	};
}

function parsePort(input: string | undefined) {
	if (!input) {
		return DEFAULT_PORT;
	}

	if (!/^\d+$/.test(input)) {
		throw new Error(
			`INNGEST_ORCHESTRATOR_PORT must be a positive integer. Received "${input}".`,
		);
	}

	const value = Number.parseInt(input, 10);
	if (value <= 0) {
		throw new Error(
			`INNGEST_ORCHESTRATOR_PORT must be a positive integer. Received "${input}".`,
		);
	}

	return value;
}
