import type { RunProjectionRecord } from "../runs/store/types.ts";
import type { RunSummary } from "./types.ts";

export function summarizeRun(run: RunProjectionRecord): RunSummary {
	return {
		runId: run.runId,
		workflowId: run.launch.workflow.workflowId,
		workflowName: run.launch.workflow.name,
		status: run.status,
		currentStepId: run.currentStepId,
		createdAt: run.createdAt,
		updatedAt: run.updatedAt,
		latestEventSequence: run.latestEventSequence,
	};
}
