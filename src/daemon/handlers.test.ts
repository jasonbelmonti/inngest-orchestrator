import { expect, test } from "bun:test";
import { handleRunControl } from "./handlers.ts";
import type { RunEventStreamBroker } from "./sse.ts";
import type { SQLiteRunStore } from "../runs/store/sqlite-store.ts";
import type {
	RunProjectionRecord,
	StoredRunEvent,
} from "../runs/store/types.ts";

test("handleRunControl publishes only the event appended by its own mutation", async () => {
	const publishedEvents: StoredRunEvent[][] = [];

	const store = {
		appendEvent: () =>
			({
				runId: "run-001",
				latestEventSequence: 5,
			}) as RunProjectionRecord,
		listEvents: () =>
			[
				makeStoredEvent(1, "run.created"),
				makeStoredEvent(2, "run.started"),
				makeStoredEvent(3, "step.started"),
				makeStoredEvent(4, "approval.requested"),
				makeStoredEvent(5, "run.cancelled"),
			] satisfies StoredRunEvent[],
	} as unknown as SQLiteRunStore;

	const eventStreamBroker = {
		publish: (_runId: string, events: StoredRunEvent[]) => {
			publishedEvents.push(events);
		},
	} as RunEventStreamBroker;

	const response = await handleRunControl(
		new Request("http://daemon.test/runs/run-001/control", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				action: "cancel",
				reason: "operator stopped run",
			}),
		}),
		"run-001",
		{
			store,
			eventStreamBroker,
			generateRunId: () => "unused",
			now: () => "2026-03-11T12:00:00.000Z",
		},
	);

	expect(response.status).toBe(200);
	expect(publishedEvents).toEqual([
		[
			expect.objectContaining({
				runId: "run-001",
				sequence: 5,
				type: "run.cancelled",
			}),
		],
	]);
});

function makeStoredEvent(
	sequence: number,
	type: StoredRunEvent["type"],
): StoredRunEvent {
	const base = {
		runId: "run-001",
		sequence,
		occurredAt: "2026-03-11T12:00:00.000Z",
	};

	switch (type) {
		case "run.created":
			return {
				...base,
				type,
				launch: {} as RunProjectionRecord["launch"],
			};
		case "run.started":
		case "run.completed":
			return {
				...base,
				type,
			};
		case "step.started":
			return {
				...base,
				type,
				stepId: "implement",
			};
		case "approval.requested":
			return {
				...base,
				type,
				approvalId: "approval-001",
				stepId: "implement",
			};
		case "run.cancelled":
			return {
				...base,
				type,
				reason: "operator stopped run",
			};
		default:
			throw new Error(`Unsupported test event type: ${type}`);
	}
}
