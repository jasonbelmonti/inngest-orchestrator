import type { ResolvedRunLaunchRequest } from "../runs/types.ts";
import type {
	CompiledWorkflowExecutionTarget,
	WorkflowNodeTemplate,
	WorkflowWorktreeStrategy,
} from "../workflows/types.ts";

export interface RuntimeResolvedTarget {
	repoId: string;
	resolvedPath: string;
	worktreeStrategy: WorkflowWorktreeStrategy;
}

export type RuntimeExecutionPlanStep =
	| {
			id: string;
			kind: "task";
			template: Extract<WorkflowNodeTemplate, "task.agent">;
			label: string;
			target: RuntimeResolvedTarget;
			prompt: string | null;
	  }
	| {
			id: string;
			kind: "check";
			template: Extract<WorkflowNodeTemplate, "check.shell">;
			label: string;
			target: RuntimeResolvedTarget;
			command: string;
	  }
	| {
			id: string;
			kind: "terminal";
			template: Extract<WorkflowNodeTemplate, "terminal.complete">;
			label: string;
	  };

export interface RuntimeExecutionPlan {
	runId: string;
	workflowId: string;
	workflowName: string;
	steps: RuntimeExecutionPlanStep[];
}

export interface RuntimeExecutionPlanInput {
	runId: string;
	launch: ResolvedRunLaunchRequest;
}

export interface RuntimeTargetResolutionInput {
	nodeId: string;
	target: CompiledWorkflowExecutionTarget;
	repoBindings: ResolvedRunLaunchRequest["repoBindings"];
}

export interface RuntimeShellOutputPreview {
	preview: string;
	byteLength: number;
	truncated: boolean;
}

export interface RuntimeShellCheckArtifactMetadata
	extends Record<string, unknown> {
	schemaVersion: 1;
	command: string;
	exitCode: number;
	stdout: RuntimeShellOutputPreview;
	stderr: RuntimeShellOutputPreview;
}

export interface RuntimeShellCheckArtifactReference {
	kind: "shell-check-report";
	repoId: string;
	relativePath: string;
	metadata: RuntimeShellCheckArtifactMetadata;
}

export interface RuntimeShellCheckArtifactFile {
	schemaVersion: 1;
	runId: string;
	stepId: string;
	repoId: string;
	command: string;
	exitCode: number;
	status: "completed" | "failed";
	stdout: {
		text: string;
		byteLength: number;
	};
	stderr: {
		text: string;
		byteLength: number;
	};
}

export interface RuntimeShellCheckResult {
	stepId: string;
	repoId: string;
	command: string;
	exitCode: number;
	status: "completed" | "failed";
	artifact: RuntimeShellCheckArtifactReference;
}
