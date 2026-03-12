import type { WorkflowRecord } from "../workflows/types.ts";
import { compileWorkflowDocument } from "../workflows/compiler.ts";
import { RuntimePlanError, type RuntimeIssue } from "./errors.ts";
import type {
	RuntimeExecutionPlan,
	RuntimeExecutionPlanInput,
	RuntimeExecutionPlanStep,
	RuntimeResolvedTarget,
	RuntimeTargetResolutionInput,
} from "./types.ts";

export function createRuntimeExecutionPlan(input: {
	run: RuntimeExecutionPlanInput;
	workflowRecord: WorkflowRecord;
}): RuntimeExecutionPlan {
	const snapshotIssues = validateWorkflowSnapshot(input);
	if (snapshotIssues.length > 0) {
		throw new RuntimePlanError(
			"Run launch snapshot no longer matches the workflow record loaded for execution.",
			snapshotIssues,
		);
	}

	const compiled = compileWorkflowDocument({
		document: input.workflowRecord.document,
		repoCatalog: input.workflowRecord.repoCatalog,
		filePath: input.workflowRecord.filePath,
	});
	const issues: RuntimeIssue[] = [];
	const nodeById = new Map(compiled.nodes.map((node) => [node.id, node]));
	const outgoingBySource = new Map<string, typeof compiled.edges>();

	for (const edge of compiled.edges) {
		const outgoing = outgoingBySource.get(edge.sourceId) ?? [];
		outgoing.push(edge);
		outgoingBySource.set(edge.sourceId, outgoing);
	}

	const trigger = compiled.nodes.find((node) => node.kind === "trigger");
	if (!trigger) {
		throw new RuntimePlanError("Runtime execution plan is missing a trigger.", [
			{
				code: "missing_trigger",
				message: "Runtime execution requires exactly one trigger node.",
				path: "$.nodes",
			},
		]);
	}

	const steps: RuntimeExecutionPlanStep[] = [];
	let currentNodeId = readRequiredSuccessor({
		nodeId: trigger.id,
		nodeKind: trigger.kind,
		outgoingBySource,
		issues,
	});

	while (currentNodeId) {
		const currentNode = nodeById.get(currentNodeId);
		if (!currentNode) {
			issues.push({
				code: "missing_node_reference",
				message: `Runtime execution references missing node "${currentNodeId}".`,
				path: "$.edges",
			});
			break;
		}

		switch (currentNode.template) {
			case "task.agent": {
				const target = resolveTarget({
					nodeId: currentNode.id,
					target: currentNode.target,
					repoBindings: input.run.launch.repoBindings,
				});
				if (!target) {
					issues.push({
						code: "missing_resolved_repo_target",
						message: `Node "${currentNode.id}" targets repo "${currentNode.target.repoId}" but no resolved local path is available for this run.`,
						path: `$.nodes.${currentNode.id}.target.repoId`,
					});
					currentNodeId = null;
					break;
				}

				steps.push({
					id: currentNode.id,
					kind: "task",
					template: currentNode.template,
					label: currentNode.label,
					target,
					prompt: readOptionalString(currentNode.settings.prompt),
				});
				currentNodeId = readRequiredSuccessor({
					nodeId: currentNode.id,
					nodeKind: currentNode.kind,
					outgoingBySource,
					issues,
				});
				break;
			}
			case "check.shell": {
				const target = resolveTarget({
					nodeId: currentNode.id,
					target: currentNode.target,
					repoBindings: input.run.launch.repoBindings,
				});
				if (!target) {
					issues.push({
						code: "missing_resolved_repo_target",
						message: `Node "${currentNode.id}" targets repo "${currentNode.target.repoId}" but no resolved local path is available for this run.`,
						path: `$.nodes.${currentNode.id}.target.repoId`,
					});
					currentNodeId = null;
					break;
				}

				const command = readRequiredString({
					value: currentNode.settings.command,
					nodeId: currentNode.id,
					field: "command",
					issues,
				});
				if (!command) {
					currentNodeId = null;
					break;
				}

				steps.push({
					id: currentNode.id,
					kind: "check",
					template: currentNode.template,
					label: currentNode.label,
					target,
					command,
				});
				currentNodeId = readRequiredSuccessor({
					nodeId: currentNode.id,
					nodeKind: currentNode.kind,
					outgoingBySource,
					issues,
				});
				break;
			}
			case "terminal.complete": {
				const outgoing = outgoingBySource.get(currentNode.id) ?? [];
				if (outgoing.length > 0) {
					issues.push({
						code: "unexpected_terminal_transition",
						message: `Terminal node "${currentNode.id}" cannot have outgoing runtime transitions.`,
						path: `$.nodes.${currentNode.id}`,
					});
					break;
				}

				steps.push({
					id: currentNode.id,
					kind: "terminal",
					template: currentNode.template,
					label: currentNode.label,
				});
				currentNodeId = null;
				break;
			}
			case "gate.approval":
			case "artifact.capture":
				issues.push({
					code: "unsupported_runtime_template",
					message: `Template "${currentNode.template}" is not supported in BEL-371 runtime planning.`,
					path: `$.nodes.${currentNode.id}.settings.template`,
				});
				currentNodeId = null;
				break;
			case "trigger.manual":
				issues.push({
					code: "unexpected_trigger_position",
					message: `Trigger node "${currentNode.id}" cannot appear after execution has started.`,
					path: `$.nodes.${currentNode.id}.kind`,
				});
				currentNodeId = null;
				break;
		}
	}

	if (issues.length > 0) {
		throw new RuntimePlanError(
			"Workflow cannot be compiled into the BEL-371 runtime subset.",
			issues,
		);
	}

	return {
		runId: input.run.runId,
		workflowId: compiled.workflowId,
		workflowName: compiled.name,
		steps,
	};
}

function validateWorkflowSnapshot(input: {
	run: RuntimeExecutionPlanInput;
	workflowRecord: WorkflowRecord;
}) {
	const issues: RuntimeIssue[] = [];

	if (
		input.run.launch.workflow.workflowId !== input.workflowRecord.workflowId
	) {
		issues.push({
			code: "workflow_snapshot_mismatch",
			message:
				"Run launch workflowId does not match the workflow record loaded for execution.",
			path: "$.launch.workflow.workflowId",
		});
	}

	if (
		input.run.launch.workflow.contentHash !== input.workflowRecord.contentHash
	) {
		issues.push({
			code: "workflow_snapshot_mismatch",
			message:
				"Run launch contentHash does not match the workflow record loaded for execution.",
			path: "$.launch.workflow.contentHash",
		});
	}

	if (input.run.launch.workflow.filePath !== input.workflowRecord.filePath) {
		issues.push({
			code: "workflow_snapshot_mismatch",
			message:
				"Run launch filePath does not match the workflow record loaded for execution.",
			path: "$.launch.workflow.filePath",
		});
	}

	return issues;
}

function readRequiredSuccessor(input: {
	nodeId: string;
	nodeKind: "trigger" | "task" | "check";
	outgoingBySource: Map<
		string,
		Array<{ sourceId: string; targetId: string; condition: string }>
	>;
	issues: RuntimeIssue[];
}) {
	const outgoing = input.outgoingBySource.get(input.nodeId) ?? [];
	const expectedCondition =
		input.nodeKind === "trigger" ? "always" : "on_success";
	const unexpected = outgoing.filter(
		(edge) => edge.condition !== expectedCondition,
	);

	for (const edge of unexpected) {
		input.issues.push({
			code: "unsupported_runtime_transition",
			message: `Node "${input.nodeId}" uses transition "${edge.condition}", which is not supported in BEL-371 runtime planning.`,
			path: `$.edges.${edge.sourceId}->${edge.targetId}`,
		});
	}

	const expectedEdge = outgoing.find(
		(edge) => edge.condition === expectedCondition,
	);
	if (!expectedEdge) {
		input.issues.push({
			code: "missing_runtime_transition",
			message: `Node "${input.nodeId}" is missing required "${expectedCondition}" transition for runtime planning.`,
			path: `$.nodes.${input.nodeId}`,
		});
		return null;
	}

	return expectedEdge.targetId;
}

function resolveTarget(
	input: RuntimeTargetResolutionInput,
): RuntimeResolvedTarget | null {
	const resolvedBinding = input.repoBindings.find(
		(
			binding,
		): binding is Extract<
			(typeof input.repoBindings)[number],
			{ status: "resolved" }
		> =>
			binding.repoId === input.target.repoId && binding.status === "resolved",
	);
	if (!resolvedBinding) {
		return null;
	}

	return {
		repoId: input.target.repoId,
		resolvedPath: resolvedBinding.resolvedPath,
		worktreeStrategy: input.target.worktreeStrategy,
	};
}

function readRequiredString(input: {
	value: unknown;
	nodeId: string;
	field: string;
	issues: RuntimeIssue[];
}) {
	if (typeof input.value === "string" && input.value.trim().length > 0) {
		return input.value;
	}

	input.issues.push({
		code: "invalid_runtime_setting",
		message: `Node "${input.nodeId}" must define a non-empty string "${input.field}" setting for runtime planning.`,
		path: `$.nodes.${input.nodeId}.settings.${input.field}`,
	});
	return null;
}

function readOptionalString(value: unknown) {
	return typeof value === "string" && value.length > 0 ? value : null;
}
