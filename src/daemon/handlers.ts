import { resolveRunLaunchRequest } from "../runs/repo-bindings.ts";
import type { SQLiteRunStore } from "../runs/store/sqlite-store.ts";
import type { RunProjectionRecord } from "../runs/store/types.ts";
import { createRuntimeExecutionPlan } from "../runtime/execution-plan.ts";
import { WorkflowStore } from "../workflows/store.ts";
import { DaemonHttpError } from "./errors.ts";
import { toRunControlEvent } from "./control-events.ts";
import { resolveRunEventReplay } from "./event-replay.ts";
import { parseRunControlRequest, readJsonBody } from "./parsing.ts";
import { successResponse } from "./responses.ts";
import { summarizeRun } from "./run-mappers.ts";
import type { RunEventStreamBroker } from "./sse.ts";
import type { DaemonRequestHandler, RuntimeDispatchFunction } from "./types.ts";

export interface DaemonHandlerOptions {
	store: SQLiteRunStore;
	eventStreamBroker: RunEventStreamBroker;
	generateRunId: () => string;
	now: () => string;
	dispatchRun: RuntimeDispatchFunction;
	inngestHandler: DaemonRequestHandler;
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

	try {
		await options.dispatchRun({ runId });
	} catch (error) {
		const failedRun = options.store.appendEvent({
			runId,
			event: {
				type: "run.failed",
				occurredAt: options.now(),
				message: `Persisted run "${runId}" could not be dispatched to the runtime.`,
			},
		});
		publishEventSequences(options.store, options.eventStreamBroker, runId, [
			failedRun.latestEventSequence,
		]);
		throw new DaemonHttpError({
			status: 500,
			code: "runtime_dispatch_failed",
			message: `Persisted run "${runId}" could not be dispatched to the runtime.`,
			runId,
			cause: error,
		});
	}

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

	const replay = resolveRunEventReplay(request, store, run);
	const afterSequence = replay.afterSequence;
	return eventStreamBroker.openStream({
		runId,
		signal: request.signal,
		resolveInitialEvents:
			afterSequence === null
				? undefined
				: () =>
						store.listEventsAfter({
							runId,
							afterSequence,
						}),
	});
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

	if (
		control.action === "resolve_approval" &&
		(await shouldRedispatchApprovalResolution(run, control.approvalId))
	) {
		try {
			await options.dispatchRun({ runId });
		} catch (error) {
			const failedRun = options.store.appendEvent({
				runId,
				event: {
					type: "run.failed",
					occurredAt: options.now(),
					message: `Persisted run "${runId}" could not be resumed after approval resolution.`,
				},
			});
			publishEventSequences(options.store, options.eventStreamBroker, runId, [
				failedRun.latestEventSequence,
			]);
			throw new DaemonHttpError({
				status: 500,
				code: "runtime_dispatch_failed",
				message: `Persisted run "${runId}" could not be resumed after approval resolution.`,
				runId,
				cause: error,
			});
		}
	}

	return successResponse(200, { run });
}

async function shouldRedispatchApprovalResolution(
	run: RunProjectionRecord,
	approvalId: string,
) {
	if (run.currentStepId === null) {
		return false;
	}

	const looksLikeRuntimeApproval =
		approvalId === `approval:${run.currentStepId}`;
	if (!looksLikeRuntimeApproval) {
		return false;
	}

	try {
		const workflowStore = await WorkflowStore.open({
			configRoot: run.launch.configRoot,
		});
		const workflowRecord = await workflowStore.readWorkflow(
			run.launch.workflow.workflowId,
		);
		const plan = createRuntimeExecutionPlan({
			run: {
				runId: run.runId,
				launch: run.launch,
			},
			workflowRecord,
		});
		const step = plan.steps.find(
			(candidate) => candidate.id === run.currentStepId,
		);
		return step?.kind === "approval" && step.approvalId === approvalId;
	} catch {
		return false;
	}
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
