import { describe, expect, test } from "bun:test";
import { resolveDaemonRuntimeConfig } from "./config.ts";

describe("resolveDaemonRuntimeConfig", () => {
	test("uses correctly spelled INNGEST_* env vars", () => {
		const config = resolveDaemonRuntimeConfig({
			INNGEST_ORCHESTRATOR_HOST: "0.0.0.0",
			INNGEST_ORCHESTRATOR_PORT: "4010",
			INNGEST_ORCHESTRATOR_DB_PATH: "/tmp/inngest-orchestrator.sqlite",
		});

		expect(config).toMatchObject({
			host: "0.0.0.0",
			port: 4010,
			databasePath: "/tmp/inngest-orchestrator.sqlite",
		});
	});

	test("rejects partially numeric port values", () => {
		expect(() =>
			resolveDaemonRuntimeConfig({
				INNGEST_ORCHESTRATOR_PORT: "3017abc",
			}),
		).toThrow(
			'INNGEST_ORCHESTRATOR_PORT must be a positive integer. Received "3017abc".',
		);
	});
});
