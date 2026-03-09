export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
	[key: string]: JsonValue;
}

export type WorkflowNodeKind =
	| "trigger"
	| "task"
	| "check"
	| "gate"
	| "artifact"
	| "terminal";

export type WorkflowEdgeCondition =
	| "always"
	| "on_success"
	| "on_failure"
	| "on_approval";

export type WorkflowWorktreeStrategy = "shared" | "ephemeral";

export type WorkflowNodeTemplate =
	| "trigger.manual"
	| "task.agent"
	| "gate.approval"
	| "check.shell"
	| "artifact.capture"
	| "terminal.complete";

export interface WorkflowRepositoryCatalogEntry {
	id: string;
	label: string;
	description?: string;
}

export interface WorkflowRepositoryCatalog {
	schemaVersion: 1;
	repositories: WorkflowRepositoryCatalogEntry[];
}

export interface WorkflowRepositoryBinding {
	id: string;
	required: boolean;
	label?: string;
}

export interface WorkflowExecutionTarget {
	repoId: string;
	worktreeStrategy?: WorkflowWorktreeStrategy;
}

export interface WorkflowPhase {
	id: string;
	label: string;
	order: number;
}

export interface WorkflowNode {
	id: string;
	kind: WorkflowNodeKind;
	label: string;
	phaseId: string;
	description?: string;
	station?: string;
	target?: WorkflowExecutionTarget;
	settings: JsonObject;
}

export interface WorkflowEdge {
	id: string;
	sourceId: string;
	targetId: string;
	condition: WorkflowEdgeCondition;
}

export interface WorkflowDocument {
	schemaVersion: 1;
	workflowId: string;
	name: string;
	summary?: string;
	repositories: WorkflowRepositoryBinding[];
	phases: WorkflowPhase[];
	nodes: WorkflowNode[];
	edges: WorkflowEdge[];
}

export interface WorkflowSummary {
	workflowId: string;
	name: string;
	summary?: string;
	updatedAt: string;
	nodeCount: number;
	edgeCount: number;
	contentHash: string;
	filePath: string;
}

export interface WorkflowRecord extends WorkflowSummary {
	document: WorkflowDocument;
	repoCatalog: WorkflowRepositoryCatalog;
}

export interface CompiledWorkflowRepositoryBinding
	extends WorkflowRepositoryBinding {
	label: string;
}

export interface CompiledWorkflowExecutionTarget {
	repoId: string;
	worktreeStrategy: WorkflowWorktreeStrategy;
}

interface CompiledWorkflowNodeBase {
	id: string;
	kind: WorkflowNodeKind;
	label: string;
	phaseId: string;
	description?: string;
	station?: string;
	settings: JsonObject;
}

export type CompiledWorkflowNode =
	| (CompiledWorkflowNodeBase & {
			kind: "trigger";
			template: "trigger.manual";
	  })
	| (CompiledWorkflowNodeBase & {
			kind: "task";
			template: "task.agent";
			target: CompiledWorkflowExecutionTarget;
	  })
	| (CompiledWorkflowNodeBase & {
			kind: "gate";
			template: "gate.approval";
	  })
	| (CompiledWorkflowNodeBase & {
			kind: "check";
			template: "check.shell";
			target: CompiledWorkflowExecutionTarget;
	  })
	| (CompiledWorkflowNodeBase & {
			kind: "artifact";
			template: "artifact.capture";
			target: CompiledWorkflowExecutionTarget;
	  })
	| (CompiledWorkflowNodeBase & {
			kind: "terminal";
			template: "terminal.complete";
	  });

export interface CompiledWorkflowDocument {
	schemaVersion: 1;
	workflowId: string;
	name: string;
	summary?: string;
	repositories: CompiledWorkflowRepositoryBinding[];
	phases: WorkflowPhase[];
	nodes: CompiledWorkflowNode[];
	edges: WorkflowEdge[];
}
