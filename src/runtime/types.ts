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
