export interface RuntimeIssue {
	code:
		| "invalid_runtime_setting"
		| "missing_resolved_repo_target"
		| "missing_runtime_transition"
		| "missing_trigger"
		| "missing_node_reference"
		| "workflow_snapshot_mismatch"
		| "unexpected_terminal_transition"
		| "unexpected_trigger_position"
		| "unsupported_runtime_template"
		| "unsupported_runtime_transition";
	message: string;
	path?: string;
}

export class RuntimePlanError extends Error {
	readonly code = "invalid_runtime_execution_plan";

	constructor(
		message: string,
		readonly issues: RuntimeIssue[],
	) {
		super(message);
		this.name = "RuntimePlanError";
	}
}
