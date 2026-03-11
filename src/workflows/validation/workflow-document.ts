import {
	WorkflowError,
	createIssue,
	type WorkflowValidationIssue,
} from "../errors.ts";
import type {
	WorkflowDocument,
	WorkflowEdge,
	WorkflowExecutionTarget,
	WorkflowNode,
	WorkflowPhase,
	WorkflowRepositoryBinding,
	WorkflowRepositoryCatalog,
} from "../types.ts";
import {
	appendDuplicateIdIssues,
	asBoolean,
	asFiniteNumber,
	asJsonObject,
	asNonEmptyString,
	asObject,
	asOptionalString,
	asOptionalWorktreeStrategy,
	asWorkflowEdgeCondition,
	asWorkflowNodeKind,
	pushInvalidShape,
} from "./shared.ts";

interface ParseWorkflowDocumentOptions {
	filePath: string;
	repoCatalog: WorkflowRepositoryCatalog;
}

export function parseWorkflowDocument(
	input: unknown,
	options: ParseWorkflowDocumentOptions,
): WorkflowDocument {
	const issues: WorkflowValidationIssue[] = [];
	const root = asObject(input, "$", issues);

	const schemaVersion =
		root && root.schemaVersion === 1
			? 1
			: pushInvalidShape(issues, "$.schemaVersion", "schemaVersion must be 1.");
	const workflowId = asNonEmptyString(root?.workflowId, "$.workflowId", issues);
	const name = asNonEmptyString(root?.name, "$.name", issues);
	const summary = asOptionalString(root?.summary, "$.summary", issues);

	const repositories = parseRepositoryBindings(root?.repositories, issues);
	const phases = parsePhases(root?.phases, issues);
	const nodes = parseNodes(root?.nodes, issues);
	const edges = parseEdges(root?.edges, issues);

	const catalogRepositoryIds = new Set(
		options.repoCatalog.repositories.map((repository) => repository.id),
	);
	const workflowRepositoryIds = new Set(
		repositories.map((repository) => repository.id),
	);
	const phaseIds = new Set(phases.map((phase) => phase.id));
	const nodeIds = new Set(nodes.map((node) => node.id));

	for (const [index, repository] of repositories.entries()) {
		if (!catalogRepositoryIds.has(repository.id)) {
			issues.push(
				createIssue(
					"unknown_repository",
					`$.repositories[${index}].id`,
					`Repository "${repository.id}" is not declared in the config-root catalog.`,
				),
			);
		}
	}

	for (const [index, node] of nodes.entries()) {
		if (!phaseIds.has(node.phaseId)) {
			issues.push(
				createIssue(
					"missing_phase",
					`$.nodes[${index}].phaseId`,
					`Node "${node.id}" references missing phase "${node.phaseId}".`,
				),
			);
		}

		if (!("target" in node)) {
			continue;
		}

		if (!catalogRepositoryIds.has(node.target.repoId)) {
			issues.push(
				createIssue(
					"unknown_repository",
					`$.nodes[${index}].target.repoId`,
					`Node "${node.id}" references unknown repository "${node.target.repoId}".`,
				),
			);
		}

		if (!workflowRepositoryIds.has(node.target.repoId)) {
			issues.push(
				createIssue(
					"undeclared_workflow_repository",
					`$.nodes[${index}].target.repoId`,
					`Node "${node.id}" targets repository "${node.target.repoId}" without declaring it in the workflow.`,
				),
			);
		}
	}

	for (const [index, edge] of edges.entries()) {
		if (!nodeIds.has(edge.sourceId)) {
			issues.push(
				createIssue(
					"missing_node",
					`$.edges[${index}].sourceId`,
					`Edge "${edge.id}" references missing source node "${edge.sourceId}".`,
				),
			);
		}
		if (!nodeIds.has(edge.targetId)) {
			issues.push(
				createIssue(
					"missing_node",
					`$.edges[${index}].targetId`,
					`Edge "${edge.id}" references missing target node "${edge.targetId}".`,
				),
			);
		}
	}

	if (issues.length > 0 || schemaVersion !== 1 || !workflowId || !name) {
		throw new WorkflowError({
			code: "invalid_workflow_document",
			message: "Workflow document validation failed.",
			filePath: options.filePath,
			issues,
		});
	}

	return {
		schemaVersion,
		workflowId,
		name,
		...(summary ? { summary } : {}),
		repositories,
		phases,
		nodes,
		edges,
	};
}

function parseRepositoryBindings(
	value: unknown,
	issues: WorkflowValidationIssue[],
): WorkflowRepositoryBinding[] {
	if (!Array.isArray(value)) {
		pushInvalidShape(
			issues,
			"$.repositories",
			"repositories must be an array.",
		);
		return [];
	}

	const repositories: WorkflowRepositoryBinding[] = [];
	for (const [index, candidate] of value.entries()) {
		const path = `$.repositories[${index}]`;
		const repository = asObject(candidate, path, issues);
		if (!repository) {
			continue;
		}
		const id = asNonEmptyString(repository.id, `${path}.id`, issues);
		const required = asBoolean(repository.required, `${path}.required`, issues);
		const label = asOptionalString(repository.label, `${path}.label`, issues);
		if (!id || required === null) {
			continue;
		}
		repositories.push({
			id,
			required,
			...(label ? { label } : {}),
		});
	}

	appendDuplicateIdIssues({
		entries: repositories,
		pathPrefix: "$.repositories",
		issueCode: "duplicate_repository_id",
		issues,
	});

	return repositories;
}

function parsePhases(
	value: unknown,
	issues: WorkflowValidationIssue[],
): WorkflowPhase[] {
	if (!Array.isArray(value)) {
		pushInvalidShape(issues, "$.phases", "phases must be an array.");
		return [];
	}

	const phases: WorkflowPhase[] = [];
	for (const [index, candidate] of value.entries()) {
		const path = `$.phases[${index}]`;
		const phase = asObject(candidate, path, issues);
		if (!phase) {
			continue;
		}
		const id = asNonEmptyString(phase.id, `${path}.id`, issues);
		const label = asNonEmptyString(phase.label, `${path}.label`, issues);
		const order = asFiniteNumber(phase.order, `${path}.order`, issues);
		if (!id || !label || order === null) {
			continue;
		}
		phases.push({ id, label, order });
	}

	appendDuplicateIdIssues({
		entries: phases,
		pathPrefix: "$.phases",
		issueCode: "duplicate_phase_id",
		issues,
	});

	return phases;
}

function parseNodes(
	value: unknown,
	issues: WorkflowValidationIssue[],
): WorkflowNode[] {
	if (!Array.isArray(value)) {
		pushInvalidShape(issues, "$.nodes", "nodes must be an array.");
		return [];
	}

	const nodes: WorkflowNode[] = [];
	for (const [index, candidate] of value.entries()) {
		const path = `$.nodes[${index}]`;
		const node = asObject(candidate, path, issues);
		if (!node) {
			continue;
		}
		const id = asNonEmptyString(node.id, `${path}.id`, issues);
		const kind = asWorkflowNodeKind(node.kind, `${path}.kind`, issues);
		const label = asNonEmptyString(node.label, `${path}.label`, issues);
		const phaseId = asNonEmptyString(node.phaseId, `${path}.phaseId`, issues);
		const description = asOptionalString(
			node.description,
			`${path}.description`,
			issues,
		);
		const station = asOptionalString(node.station, `${path}.station`, issues);
		const target = parseExecutionTarget(node.target, `${path}.target`, issues);
		const settings = asJsonObject(node.settings, `${path}.settings`, issues);
		if (!id || !kind || !label || !phaseId || !settings) {
			continue;
		}

		const baseNode = {
			id,
			label,
			phaseId,
			...(description ? { description } : {}),
			...(station ? { station } : {}),
			settings,
		};

		switch (kind) {
			case "task":
			case "check":
			case "artifact":
				if (!target) {
					issues.push(
						createIssue(
							"missing_repo_target",
							`${path}.target`,
							`Node "${id}" requires a repo target.`,
						),
					);
					continue;
				}
				nodes.push({
					...baseNode,
					kind,
					target,
				});
				continue;
			case "trigger":
			case "gate":
			case "terminal":
				if (target) {
					issues.push(
						createIssue(
							"unexpected_repo_target",
							`${path}.target`,
							`Node "${id}" must not declare a repo target.`,
						),
					);
					continue;
				}
				nodes.push({
					...baseNode,
					kind,
				});
				continue;
		}
	}

	appendDuplicateIdIssues({
		entries: nodes,
		pathPrefix: "$.nodes",
		issueCode: "duplicate_node_id",
		issues,
	});

	return nodes;
}

function parseEdges(
	value: unknown,
	issues: WorkflowValidationIssue[],
): WorkflowEdge[] {
	if (!Array.isArray(value)) {
		pushInvalidShape(issues, "$.edges", "edges must be an array.");
		return [];
	}

	const edges: WorkflowEdge[] = [];
	for (const [index, candidate] of value.entries()) {
		const path = `$.edges[${index}]`;
		const edge = asObject(candidate, path, issues);
		if (!edge) {
			continue;
		}
		const id = asNonEmptyString(edge.id, `${path}.id`, issues);
		const sourceId = asNonEmptyString(
			edge.sourceId,
			`${path}.sourceId`,
			issues,
		);
		const targetId = asNonEmptyString(
			edge.targetId,
			`${path}.targetId`,
			issues,
		);
		const condition = asWorkflowEdgeCondition(
			edge.condition,
			`${path}.condition`,
			issues,
		);
		if (!id || !sourceId || !targetId || !condition) {
			continue;
		}
		edges.push({ id, sourceId, targetId, condition });
	}

	appendDuplicateIdIssues({
		entries: edges,
		pathPrefix: "$.edges",
		issueCode: "duplicate_edge_id",
		issues,
	});

	return edges;
}

function parseExecutionTarget(
	value: unknown,
	path: string,
	issues: WorkflowValidationIssue[],
): WorkflowExecutionTarget | undefined {
	if (value === undefined) {
		return undefined;
	}

	const target = asObject(value, path, issues);
	if (!target) {
		return undefined;
	}
	const repoId = asNonEmptyString(target.repoId, `${path}.repoId`, issues);
	const worktreeStrategy = asOptionalWorktreeStrategy(
		target.worktreeStrategy,
		`${path}.worktreeStrategy`,
		issues,
	);
	if (!repoId) {
		return undefined;
	}
	return {
		repoId,
		...(worktreeStrategy ? { worktreeStrategy } : {}),
	};
}
