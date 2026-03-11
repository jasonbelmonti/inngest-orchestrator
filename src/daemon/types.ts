import type { RunLaunchIssue } from "../runs/errors.ts";
import type { RunProjectionRecord } from "../runs/store/types.ts";

export interface RunSummary {
	runId: string;
	workflowId: string;
	workflowName: string;
	status: RunProjectionRecord["status"];
	currentStepId: string | null;
	createdAt: string;
	updatedAt: string;
	latestEventSequence: number;
}

export type RunControlRequest =
	| {
			action: "cancel";
			reason?: string;
	  }
	| {
			action: "request_approval";
			approvalId: string;
			stepId: string;
			message?: string;
	  }
	| {
			action: "resolve_approval";
			approvalId: string;
			decision: "approved" | "rejected";
			comment?: string;
	  };

export interface DaemonErrorBody {
	code: string;
	message: string;
	issues?: RunLaunchIssue[];
	runId?: string;
}
