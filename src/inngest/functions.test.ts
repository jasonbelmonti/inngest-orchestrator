import { describe, expect, test } from "bun:test";
import { dispatchPersistedRun, RUNTIME_DISPATCH_EVENT } from "./client.ts";
import { createInngestHandler } from "./functions.ts";

describe("BEL-373 Inngest bootstrap", () => {
	test("dispatchPersistedRun sends the persisted run event contract", async () => {
		const sends: unknown[] = [];

		await dispatchPersistedRun({
			client: {
				send(payload) {
					sends.push(payload);
					return Promise.resolve({
						ids: ["evt_123"],
					});
				},
			},
			runId: "run-123",
		});

		expect(sends).toEqual([
			{
				name: RUNTIME_DISPATCH_EVENT,
				data: {
					runId: "run-123",
				},
			},
		]);
	});

	test("createInngestHandler returns a Bun-compatible request handler", async () => {
		const handler = createInngestHandler();
		const response = await handler(
			new Request("http://127.0.0.1:3017/api/inngest", {
				method: "GET",
				headers: {
					host: "127.0.0.1:3017",
				},
			}),
		);

		expect(response).toBeInstanceOf(Response);
		expect(response.status).toBeGreaterThanOrEqual(200);
		expect(response.status).toBeLessThan(500);
	});
});
