import { resolveRunLaunchRequest } from "../runs/repo-bindings.ts";
import type { SQLiteRunStore } from "../runs/store/sqlite-store.ts";
import { DaemonHttpError } from "./errors.ts";
import { toRunControlEvent } from "./control-events.ts";
import { parseRunControlRequest, readJsonBody } from "./parsing.ts";
import { successResponse } from "./responses.ts";
import { summarizeRun } from "./run-mappers.ts";
import type { RunEventStreamBroker } from "./sse.ts";

export interface DaemonHandlerOptions {
	store: SQLiteRunStore;
	eventStreamBroker: RunEventStreamBroker;
	generateRunId: () => string;
	now: () => string;
}

export async function handleCreateRun(
	request: Request,
	options: DaemonHandlerOptions,
) {
	const body = await readJsonBody(request);
	const launch = await resolveRunLaunchRequest(body);
	const runId = options.generateRunId();
	const occurredAt = options.now();

	const run = options.store.createStartedRun({
		runId,
		createdAt: occurredAt,
		startedAt: occurredAt,
		launch,
	});
	publishEventSequences(
		options.store,
		options.eventStreamBroker,
		runId,
		[1, 2],
	);

	return successResponse(201, { run });
}

export function handleListRuns(store: SQLiteRunStore) {
	return successResponse(200, {
		runs: store.listRuns().map(summarizeRun),
	});
}

export function handleReadRun(runId: string, store: SQLiteRunStore) {
	const run = store.readRun(runId);
	if (!run) {
		throw new DaemonHttpError({
			status: 404,
			code: "run_store_not_found",
			message: `Run "${runId}" was not found.`,
			runId,
		});
	}

	return successResponse(200, { run });
}

export function handleRunEvents(
	runId: string,
	store: SQLiteRunStore,
	eventStreamBroker: RunEventStreamBroker,
	request: Request,
) {
	const run = store.readRun(runId);
	if (!run) {
		throw new DaemonHttpError({
			status: 404,
			code: "run_store_not_found",
			message: `Run "${runId}" was not found.`,
			runId,
		});
	}

	return eventStreamBroker.openStream(runId, request.signal);
}

export async function handleRunControl(
	request: Request,
	runId: string,
	options: DaemonHandlerOptions,
) {
	const body = await readJsonBody(request);
	const control = parseRunControlRequest(body);
	const occurredAt = options.now();
	const run = options.store.appendEvent({
		runId,
		event: toRunControlEvent(control, occurredAt),
	});
	publishEventSequences(options.store, options.eventStreamBroker, runId, [
		run.latestEventSequence,
	]);

	return successResponse(200, { run });
}

function publishEventSequences(
	store: SQLiteRunStore,
	eventStreamBroker: RunEventStreamBroker,
	runId: string,
	sequences: number[],
) {
	if (eventStreamBroker.subscriberCount(runId) === 0) {
		return;
	}

	const events = sequences
		.map((sequence) => store.readEvent({ runId, sequence }))
		.filter((event) => event !== null);
	if (events.length === 0) {
		return;
	}
	eventStreamBroker.publish(runId, events);
}
