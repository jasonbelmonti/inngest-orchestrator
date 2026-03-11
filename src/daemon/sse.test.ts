import { expect, test } from "bun:test";
import { RunEventStreamBroker } from "./sse.ts";

test("openStream does not subscribe aborted requests", async () => {
	const broker = new RunEventStreamBroker({ keepAliveMs: 60_000 });
	const abortController = new AbortController();
	abortController.abort();

	const response = broker.openStream("run-aborted", abortController.signal);
	const reader = response.body?.getReader();

	expect(broker.subscriberCount("run-aborted")).toBe(0);
	expect(getSubscriberBuckets(broker).has("run-aborted")).toBe(false);
	await expect(reader?.read()).resolves.toEqual({
		done: true,
		value: undefined,
	});
});

test("aborting an active stream removes the subscriber and closes the stream", async () => {
	const broker = new RunEventStreamBroker({ keepAliveMs: 60_000 });
	const abortController = new AbortController();

	const response = broker.openStream("run-live", abortController.signal);
	const reader = response.body?.getReader();

	expect(broker.subscriberCount("run-live")).toBe(1);

	abortController.abort();

	await expect(reader?.read()).resolves.toEqual({
		done: true,
		value: undefined,
	});
	expect(broker.subscriberCount("run-live")).toBe(0);
	expect(getSubscriberBuckets(broker).has("run-live")).toBe(false);
});

function getSubscriberBuckets(broker: RunEventStreamBroker) {
	return (
		broker as unknown as {
			subscribers: Map<string, Set<unknown>>;
		}
	).subscribers;
}
