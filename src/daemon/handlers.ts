import { resolveRunLaunchRequest } from "../runs/repo-bindings.ts";
import type { SQLiteRunStore } from "../runs/store/sqlite-store.ts";
import { DaemonHttpError } from "./errors.ts";
import { toRunControlEvent } from "./control-events.ts";
import { parseRunControlRequest, readJsonBody } from "./parsing.ts";
import { successResponse } from "./responses.ts";
import { summarizeRun } from "./run-mappers.ts";

export interface DaemonHandlerOptions {
	store: SQLiteRunStore;
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

	return successResponse(200, { run });
}
