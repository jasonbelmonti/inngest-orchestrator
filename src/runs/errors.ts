export type RunLaunchIssueCode =
	| "invalid_shape"
	| "config_root_invalid"
	| "workflow_not_found"
	| "workflow_invalid"
	| "workflow_not_executable"
	| "missing_required_repo_binding"
	| "unknown_repo_binding"
	| "invalid_repo_binding_path"
	| "repo_binding_path_not_absolute"
	| "repo_binding_path_not_found"
	| "repo_binding_path_not_directory";

export type RunLaunchErrorCode =
	| "invalid_run_launch_input"
	| "repo_binding_resolution_failed";

export interface RunLaunchIssue {
	code: RunLaunchIssueCode;
	path: string;
	message: string;
	filePath?: string;
}

interface RunLaunchErrorInput {
	code: RunLaunchErrorCode;
	message: string;
	issues?: RunLaunchIssue[];
	cause?: unknown;
}

export class RunLaunchError extends Error {
	readonly code: RunLaunchErrorCode;
	readonly issues?: RunLaunchIssue[];

	constructor(input: RunLaunchErrorInput) {
		super(input.message);
		this.name = "RunLaunchError";
		this.code = input.code;
		this.issues = input.issues;
		if (input.cause !== undefined) {
			this.cause = input.cause;
		}
	}
}

export function createRunLaunchIssue(
	code: RunLaunchIssueCode,
	path: string,
	message: string,
	filePath?: string,
): RunLaunchIssue {
	return filePath ? { code, path, message, filePath } : { code, path, message };
}
