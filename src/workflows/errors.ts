export type WorkflowValidationIssueCode =
	| "invalid_shape"
	| "duplicate_repository_id"
	| "duplicate_phase_id"
	| "duplicate_node_id"
	| "duplicate_edge_id"
	| "duplicate_workflow_id"
	| "missing_phase"
	| "missing_node"
	| "missing_repo_target"
	| "unknown_repository"
	| "undeclared_workflow_repository"
	| "unsupported_template";

export type WorkflowErrorCode =
	| "config_root_unset"
	| "config_root_not_found"
	| "workflows_directory_not_found"
	| "repository_catalog_not_found"
	| "workflow_not_found"
	| "invalid_json"
	| "invalid_repo_catalog"
	| "invalid_workflow_document"
	| "invalid_executable_workflow";

export interface WorkflowValidationIssue {
	code: WorkflowValidationIssueCode;
	path: string;
	message: string;
}

interface WorkflowErrorInput {
	code: WorkflowErrorCode;
	message: string;
	filePath?: string;
	issues?: WorkflowValidationIssue[];
	cause?: unknown;
}

export class WorkflowError extends Error {
	readonly code: WorkflowErrorCode;
	readonly filePath?: string;
	readonly issues?: WorkflowValidationIssue[];

	constructor(input: WorkflowErrorInput) {
		super(input.message);
		this.name = "WorkflowError";
		this.code = input.code;
		this.filePath = input.filePath;
		this.issues = input.issues;
		if (input.cause !== undefined) {
			this.cause = input.cause;
		}
	}
}

export function createIssue(
	code: WorkflowValidationIssueCode,
	path: string,
	message: string,
): WorkflowValidationIssue {
	return { code, path, message };
}
