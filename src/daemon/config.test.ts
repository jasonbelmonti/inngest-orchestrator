import { describe, expect, test } from "bun:test";
import { resolveDaemonRuntimeConfig } from "./config.ts";

describe("resolveDaemonRuntimeConfig", () => {
	test("uses correctly spelled INNGEST_* env vars for loopback-only binds", () => {
		const config = resolveDaemonRuntimeConfig({
			INNGEST_ORCHESTRATOR_HOST: "localhost",
			INNGEST_ORCHESTRATOR_PORT: "4010",
			INNGEST_ORCHESTRATOR_DB_PATH: "/tmp/inngest-orchestrator.sqlite",
		});

		expect(config).toMatchObject({
			host: "localhost",
			port: 4010,
			databasePath: "/tmp/inngest-orchestrator.sqlite",
		});
	});

	test("rejects non-loopback hosts", () => {
		expect(() =>
			resolveDaemonRuntimeConfig({
				INNGEST_ORCHESTRATOR_HOST: "0.0.0.0",
			}),
		).toThrow(
			'INNGEST_ORCHESTRATOR_HOST must be a loopback host. Received "0.0.0.0".',
		);
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
