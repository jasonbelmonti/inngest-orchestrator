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
const ALLOWED_LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const DEFAULT_DATABASE_PATH = resolve(
	import.meta.dir,
	"../../.local/inngest-orchestrator.sqlite",
);

export function resolveDaemonRuntimeConfig(
	env: NodeJS.ProcessEnv = process.env,
): DaemonRuntimeConfig {
	return {
		host: parseHost(env.INNGEST_ORCHESTRATOR_HOST),
		port: parsePort(env.INNGEST_ORCHESTRATOR_PORT),
		databasePath: resolveDaemonDatabasePath(env),
		idleTimeoutSeconds: DEFAULT_IDLE_TIMEOUT_SECONDS,
	};
}

export function resolveDaemonDatabasePath(
	env: NodeJS.ProcessEnv = process.env,
) {
	return env.INNGEST_ORCHESTRATOR_DB_PATH || DEFAULT_DATABASE_PATH;
}

function parseHost(input: string | undefined) {
	if (!input) {
		return DEFAULT_HOST;
	}

	if (!ALLOWED_LOOPBACK_HOSTS.has(input)) {
		throw new Error(
			`INNGEST_ORCHESTRATOR_HOST must be a loopback host. Received "${input}".`,
		);
	}

	return input;
}

function parsePort(input: string | undefined) {
	if (!input) {
		return DEFAULT_PORT;
	}

	if (!/^\d+$/.test(input)) {
		throw new Error(
			`INNGEST_ORCHESTRATOR_PORT must be an integer between 1 and 65535. Received "${input}".`,
		);
	}

	const value = Number.parseInt(input, 10);
	if (value <= 0 || value > 65_535) {
		throw new Error(
			`INNGEST_ORCHESTRATOR_PORT must be an integer between 1 and 65535. Received "${input}".`,
		);
	}

	return value;
}
