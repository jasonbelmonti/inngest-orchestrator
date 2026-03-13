import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { resolveRunLaunchRequest } from "../runs/repo-bindings.ts";
import type { StoredRunEvent } from "../runs/store/types.ts";
import { makeWorkflow } from "../workflows/test-fixtures.ts";
import {
	cleanupDaemonTestHarnesses,
	createDaemonTestHarness,
} from "./test-helpers.ts";
import { createLocalRuntimeDispatch } from "./runtime-dispatch.ts";
import type { RunEventStreamBroker } from "./sse.ts";

afterEach(async () => {
	await cleanupDaemonTestHarnesses();
});

test("createLocalRuntimeDispatch publishes only runtime-appended events when control events interleave", async () => {
	const harness = await createDaemonTestHarness();
	await Bun.write(
		join(harness.configRoot, "workflows", "cross-repo-bugfix.json"),
		`${JSON.stringify(
			makeWorkflow({
				nodes: makeWorkflow().nodes.map((node) =>
					node.id === "typecheck"
						? {
								...node,
								settings: {
									...node.settings,
									command: "sleep 0.05; printf 'shell-ok\\n'",
								},
							}
						: node,
				),
			}),
			null,
			2,
		)}\n`,
	);

	const launch = await resolveRunLaunchRequest({
		workflowId: "cross-repo-bugfix",
		configRoot: harness.configRoot,
		repoBindings: harness.repoBindings,
	});
	harness.store.createStartedRun({
		runId: "run-race",
		createdAt: "2026-03-11T12:00:00.000Z",
		startedAt: "2026-03-11T12:00:00.000Z",
		launch,
	});

	const publishedEvents: StoredRunEvent[][] = [];
	const dispatch = createLocalRuntimeDispatch({
		store: harness.store,
		eventStreamBroker: {
			subscriberCount: () => 1,
			publish: (_runId: string, events: StoredRunEvent[]) => {
				publishedEvents.push(events);
			},
		} as unknown as RunEventStreamBroker,
		now: () => "2026-03-11T12:00:00.000Z",
	});

	dispatch({ runId: "run-race" });

	await waitFor(
		() => harness.store.readRun("run-race")?.currentStepId === "typecheck",
	);
	harness.store.appendEvent({
		runId: "run-race",
		event: {
			type: "run.cancelled",
			occurredAt: "2026-03-11T12:00:00.000Z",
			reason: "operator stopped run",
		},
	});

	await waitFor(
		() => harness.store.readRun("run-race")?.status === "cancelled",
	);
	await waitFor(() => publishedEvents.length > 0);

	const flattenedEvents = publishedEvents.flat();
	expect(flattenedEvents.map((event) => event.sequence)).toEqual([3, 4, 5]);
	expect(flattenedEvents.map((event) => event.type)).toEqual([
		"step.started",
		"step.completed",
		"step.started",
	]);
	expect(flattenedEvents.some((event) => event.type === "run.cancelled")).toBe(
		false,
	);
});

async function waitFor(
	predicate: () => boolean,
	options: {
		attempts?: number;
		delayMs?: number;
	} = {},
) {
	const attempts = options.attempts ?? 40;
	const delayMs = options.delayMs ?? 5;

	for (let attempt = 0; attempt < attempts; attempt += 1) {
		if (predicate()) {
			return;
		}
		await Bun.sleep(delayMs);
	}

	throw new Error("Timed out waiting for runtime dispatch state change.");
}
