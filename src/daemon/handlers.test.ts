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
	const readEvents: number[] = [];

	const store = {
		appendEvent: () =>
			({
				runId: "run-001",
				latestEventSequence: 5,
			}) as RunProjectionRecord,
		readEvent: ({ sequence }: { runId: string; sequence: number }) => {
			readEvents.push(sequence);
			return makeStoredEvent(sequence, "run.cancelled");
		},
	} as unknown as SQLiteRunStore;

	const eventStreamBroker = {
		subscriberCount: () => 1,
		publish: (_runId: string, events: StoredRunEvent[]) => {
			publishedEvents.push(events);
		},
	} as unknown as RunEventStreamBroker;

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
			dispatchRun: () => Promise.resolve(),
			inngestHandler: () => new Response(null, { status: 204 }),
		},
	);

	expect(response.status).toBe(200);
	expect(readEvents).toEqual([5]);
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

test("handleRunControl skips persisted event lookup when there are no subscribers", async () => {
	let readEventCalls = 0;

	const store = {
		appendEvent: () =>
			({
				runId: "run-001",
				latestEventSequence: 5,
			}) as RunProjectionRecord,
		readEvent: () => {
			readEventCalls += 1;
			return makeStoredEvent(5, "run.cancelled");
		},
	} as unknown as SQLiteRunStore;

	const eventStreamBroker = {
		subscriberCount: () => 0,
		publish: () => {
			throw new Error("publish should not be called without subscribers");
		},
	} as unknown as RunEventStreamBroker;

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
			dispatchRun: () => Promise.resolve(),
			inngestHandler: () => new Response(null, { status: 204 }),
		},
	);

	expect(response.status).toBe(200);
	expect(readEventCalls).toBe(0);
});

test("handleRunControl skips redispatch for non-runtime approval resolution", async () => {
	const dispatchedRunIds: string[] = [];

	const store = {
		appendEvent: () =>
			({
				runId: "run-approval",
				currentStepId: "implement",
				launch: {
					configRoot: "/tmp/non-runtime",
					workflow: {
						workflowId: "cross-repo-bugfix",
						contentHash: "hash",
						filePath: "/tmp/non-runtime/workflows/cross-repo-bugfix.json",
					},
					repoBindings: {},
				},
				latestEventSequence: 6,
			}) as RunProjectionRecord,
		readEvent: ({ sequence }: { runId: string; sequence: number }) =>
			makeStoredEvent(sequence, "approval.resolved"),
	} as unknown as SQLiteRunStore;

	const eventStreamBroker = {
		subscriberCount: () => 0,
		publish: () => {
			throw new Error("publish should not be called without subscribers");
		},
	} as unknown as RunEventStreamBroker;

	const response = await handleRunControl(
		new Request("http://daemon.test/runs/run-approval/control", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				action: "resolve_approval",
				approvalId: "approval-operator",
				decision: "approved",
			}),
		}),
		"run-approval",
		{
			store,
			eventStreamBroker,
			generateRunId: () => "unused",
			now: () => "2026-03-11T12:00:00.000Z",
			dispatchRun: ({ runId }) => {
				dispatchedRunIds.push(runId);
				return Promise.resolve();
			},
			inngestHandler: () => new Response(null, { status: 204 }),
		},
	);

	expect(response.status).toBe(200);
	expect(dispatchedRunIds).toEqual([]);
});

test("handleRunControl skips redispatch when runtime approval verification fails", async () => {
	const dispatchedRunIds: string[] = [];

	const store = {
		appendEvent: () =>
			({
				runId: "run-approval",
				currentStepId: "implement",
				launch: {
					configRoot: "/tmp/missing-workflow-root",
					workflow: {
						workflowId: "cross-repo-bugfix",
						contentHash: "hash",
						filePath:
							"/tmp/missing-workflow-root/workflows/cross-repo-bugfix.json",
					},
					repoBindings: {},
				},
				latestEventSequence: 6,
			}) as RunProjectionRecord,
		readEvent: ({ sequence }: { runId: string; sequence: number }) =>
			makeStoredEvent(sequence, "approval.resolved"),
	} as unknown as SQLiteRunStore;

	const eventStreamBroker = {
		subscriberCount: () => 0,
		publish: () => {
			throw new Error("publish should not be called without subscribers");
		},
	} as unknown as RunEventStreamBroker;

	const response = await handleRunControl(
		new Request("http://daemon.test/runs/run-approval/control", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				action: "resolve_approval",
				approvalId: "approval:implement",
				decision: "approved",
			}),
		}),
		"run-approval",
		{
			store,
			eventStreamBroker,
			generateRunId: () => "unused",
			now: () => "2026-03-11T12:00:00.000Z",
			dispatchRun: ({ runId }) => {
				dispatchedRunIds.push(runId);
				return Promise.resolve();
			},
			inngestHandler: () => new Response(null, { status: 204 }),
		},
	);

	expect(response.status).toBe(200);
	expect(dispatchedRunIds).toEqual([]);
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
		case "run.cancelled":
			return {
				...base,
				type,
				reason: "operator stopped run",
			};
		case "approval.resolved":
			return {
				...base,
				type,
				approvalId: "approval-operator",
				decision: "approved",
			};
		default:
			throw new Error(`Unsupported test event type: ${type}`);
	}
}
