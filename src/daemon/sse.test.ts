import { expect, test } from "bun:test";
import { RunEventStreamBroker } from "./sse.ts";
import type { StoredRunEvent } from "../runs/store/types.ts";

test("openStream does not subscribe aborted requests", async () => {
	const broker = new RunEventStreamBroker({ keepAliveMs: 60_000 });
	const abortController = new AbortController();
	abortController.abort();

	const response = broker.openStream({
		runId: "run-aborted",
		signal: abortController.signal,
	});
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

	const response = broker.openStream({
		runId: "run-live",
		signal: abortController.signal,
	});
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

test("frames larger than the remaining queue budget drop slow subscribers", async () => {
	const broker = new RunEventStreamBroker({
		keepAliveMs: 60_000,
		maxBufferedBytes: 256,
	});
	const response = broker.openStream({ runId: "run-slow" });
	const reader = response.body?.getReader();

	expect(broker.subscriberCount("run-slow")).toBe(1);

	broker.publish("run-slow", [makeStoredEvent(1, "ok")]);

	expect(broker.subscriberCount("run-slow")).toBe(1);

	broker.publish("run-slow", [makeStoredEvent(2, "x".repeat(120))]);

	expect(broker.subscriberCount("run-slow")).toBe(0);
	expect(getSubscriberBuckets(broker).has("run-slow")).toBe(false);
	await expect(reader?.read()).resolves.toMatchObject({
		done: false,
		value: expect.any(Uint8Array),
	});
	await expect(reader?.read()).resolves.toEqual({
		done: true,
		value: undefined,
	});
});

test("openStream enqueues replay events before live delivery", async () => {
	const broker = new RunEventStreamBroker({ keepAliveMs: 60_000 });
	const subscriberCounts: number[] = [];
	const response = broker.openStream({
		runId: "run-replay",
		resolveInitialEvents: () => {
			subscriberCounts.push(broker.subscriberCount("run-replay"));
			return [makeStoredEvent(1, "replay")];
		},
	});
	const reader = response.body?.getReader();

	expect(broker.subscriberCount("run-replay")).toBe(1);
	expect(subscriberCounts).toEqual([1]);
	await expect(reader?.read()).resolves.toMatchObject({
		done: false,
		value: expect.any(Uint8Array),
	});

	broker.publish("run-replay", [makeStoredEvent(2, "live")]);

	await expect(reader?.read()).resolves.toMatchObject({
		done: false,
		value: expect.any(Uint8Array),
	});
	await reader?.cancel();
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
