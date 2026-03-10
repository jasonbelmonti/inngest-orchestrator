import { WorkflowError, createIssue, type WorkflowValidationIssue } from "./errors.ts";
import { appendExecutableGraphIssues } from "./executable-graph.ts";
import type {
	CompiledWorkflowDocument,
	CompiledWorkflowNode,
	CompiledWorkflowRepositoryBinding,
	JsonObject,
	WorkflowDocument,
	WorkflowNode,
	WorkflowNodeTemplate,
	WorkflowRepositoryCatalog,
} from "./types.ts";

export function compileWorkflowDocument(input: {
	document: WorkflowDocument;
	repoCatalog: WorkflowRepositoryCatalog;
	filePath?: string;
}): CompiledWorkflowDocument {
	const repositoryCatalogById = new Map(
		input.repoCatalog.repositories.map((repository) => [repository.id, repository]),
	);
	const issues: WorkflowValidationIssue[] = [];

	const repositories: CompiledWorkflowRepositoryBinding[] = input.document.repositories.map(
		(repository) => {
			const catalogEntry = repositoryCatalogById.get(repository.id);
			return {
				...repository,
				label: repository.label ?? catalogEntry?.label ?? repository.id,
			};
		},
	);

	const nodes = input.document.nodes
		.map((node, index) => compileNode(node, index, issues))
		.filter((node): node is CompiledWorkflowNode => node !== null);

	appendExecutableGraphIssues(input.document, issues);

	if (issues.length > 0) {
		throw new WorkflowError({
			code: "invalid_executable_workflow",
			message: "Workflow cannot be compiled into the supported v1 executable subset.",
			filePath: input.filePath,
			issues,
		});
	}

	return {
		schemaVersion: input.document.schemaVersion,
		workflowId: input.document.workflowId,
		name: input.document.name,
		...(input.document.summary ? { summary: input.document.summary } : {}),
		repositories,
		phases: [...input.document.phases],
		nodes,
		edges: [...input.document.edges],
	};
}

function compileNode(
	node: WorkflowNode,
	index: number,
	issues: WorkflowValidationIssue[],
): CompiledWorkflowNode | null {
	switch (node.kind) {
		case "trigger":
			if (!validateTemplate(node, index, issues, "trigger.manual")) {
				return null;
			}
			return {
				id: node.id,
				kind: "trigger",
				label: node.label,
				phaseId: node.phaseId,
				...(node.description ? { description: node.description } : {}),
				...(node.station ? { station: node.station } : {}),
				template: "trigger.manual",
				settings: node.settings,
			};
		case "task":
			if (!validateTemplate(node, index, issues, "task.agent")) {
				return null;
			}
			return {
				id: node.id,
				kind: "task",
				label: node.label,
				phaseId: node.phaseId,
				...(node.description ? { description: node.description } : {}),
				...(node.station ? { station: node.station } : {}),
				template: "task.agent",
				target: {
					repoId: node.target.repoId,
					worktreeStrategy: node.target.worktreeStrategy ?? "shared",
				},
				settings: node.settings,
			};
		case "gate":
			if (!validateTemplate(node, index, issues, "gate.approval")) {
				return null;
			}
			return {
				id: node.id,
				kind: "gate",
				label: node.label,
				phaseId: node.phaseId,
				...(node.description ? { description: node.description } : {}),
				...(node.station ? { station: node.station } : {}),
				template: "gate.approval",
				settings: node.settings,
			};
		case "check":
			if (!validateTemplate(node, index, issues, "check.shell")) {
				return null;
			}
			return {
				id: node.id,
				kind: "check",
				label: node.label,
				phaseId: node.phaseId,
				...(node.description ? { description: node.description } : {}),
				...(node.station ? { station: node.station } : {}),
				template: "check.shell",
				target: {
					repoId: node.target.repoId,
					worktreeStrategy: node.target.worktreeStrategy ?? "shared",
				},
				settings: node.settings,
			};
		case "artifact":
			if (!validateTemplate(node, index, issues, "artifact.capture")) {
				return null;
			}
			return {
				id: node.id,
				kind: "artifact",
				label: node.label,
				phaseId: node.phaseId,
				...(node.description ? { description: node.description } : {}),
				...(node.station ? { station: node.station } : {}),
				template: "artifact.capture",
				target: {
					repoId: node.target.repoId,
					worktreeStrategy: node.target.worktreeStrategy ?? "shared",
				},
				settings: node.settings,
			};
		case "terminal":
			if (!validateTemplate(node, index, issues, "terminal.complete")) {
				return null;
			}
			return {
				id: node.id,
				kind: "terminal",
				label: node.label,
				phaseId: node.phaseId,
				...(node.description ? { description: node.description } : {}),
				...(node.station ? { station: node.station } : {}),
				template: "terminal.complete",
				settings: node.settings,
			};
	}
}

function readTemplate(settings: JsonObject): WorkflowNodeTemplate | null {
	const template = settings.template;
	return typeof template === "string" ? (template as WorkflowNodeTemplate) : null;
}

function validateTemplate(
	node: WorkflowNode,
	index: number,
	issues: WorkflowValidationIssue[],
	expectedTemplate: WorkflowNodeTemplate,
): boolean {
	const template = readTemplate(node.settings);
	if (template !== expectedTemplate) {
		issues.push(
			createIssue(
				"unsupported_template",
				`$.nodes[${index}].settings.template`,
				`Node "${node.id}" must use template "${expectedTemplate}".`,
			),
		);
		return false;
	}

	return true;
}
