import type { WorkflowErrorCode, WorkflowValidationIssue } from "../workflows/errors.ts";
import type {
	CompiledWorkflowDocument,
	WorkflowRecord,
	WorkflowSummary,
} from "../workflows/types.ts";
import type { CliErrorCode } from "./errors.ts";

export type WorkflowCliCommand =
	| "workflow.list"
	| "workflow.read"
	| "workflow.validate"
	| "workflow.save";

export interface WorkflowCliErrorPayload {
	code: WorkflowErrorCode | CliErrorCode;
	message: string;
	filePath?: string;
	issues?: WorkflowValidationIssue[];
}

export type WorkflowCliResponse =
	| {
			ok: true;
			command: "workflow.list";
			configRoot: string;
			workflows: WorkflowSummary[];
	  }
	| {
			ok: true;
			command: "workflow.read";
			configRoot: string;
			workflow: WorkflowRecord;
	  }
	| {
			ok: true;
			command: "workflow.validate";
			configRoot: string;
			validation: {
				contentHash: string;
				compiled: CompiledWorkflowDocument;
				document: WorkflowRecord["document"];
				filePath: string;
			};
	  }
	| {
			ok: true;
			command: "workflow.save";
			configRoot: string;
			save: {
				operation: "created" | "updated";
				compiled: CompiledWorkflowDocument;
				workflow: WorkflowRecord;
			};
	  }
	| {
			ok: false;
			command?: WorkflowCliCommand;
			error: WorkflowCliErrorPayload;
	  };

export interface CliRunResult {
	exitCode: number;
	stderr: string;
	stdout: string;
}
