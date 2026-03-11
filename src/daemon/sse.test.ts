import { expect, test } from "bun:test";
import { RunEventStreamBroker } from "./sse.ts";
import type { StoredRunEvent } from "../runs/store/types.ts";

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

test("slow subscribers are dropped once the buffered queue limit is exceeded", async () => {
	const broker = new RunEventStreamBroker({
		keepAliveMs: 60_000,
		maxBufferedBytes: 512,
	});
	const response = broker.openStream("run-slow");
	const reader = response.body?.getReader();

	expect(broker.subscriberCount("run-slow")).toBe(1);

	broker.publish("run-slow", [
		makeStoredEvent(1, "x".repeat(120)),
		makeStoredEvent(2, "y".repeat(120)),
	]);

	expect(broker.subscriberCount("run-slow")).toBe(0);
	expect(getSubscriberBuckets(broker).has("run-slow")).toBe(false);
	await expect(reader?.read()).resolves.toMatchObject({
		done: false,
	});
	await expect(reader?.read()).resolves.toEqual({
		done: true,
		value: undefined,
	});
});

function getSubscriberBuckets(broker: RunEventStreamBroker) {
	return (
		broker as unknown as {
			subscribers: Map<string, Set<unknown>>;
		}
	).subscribers;
}

function makeStoredEvent(sequence: number, filler: string): StoredRunEvent {
	return {
		runId: "run-slow",
		sequence,
		type: "run.cancelled",
		occurredAt: "2026-03-11T12:00:00.000Z",
		reason: filler,
	};
}
