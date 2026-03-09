import { createIssue, type WorkflowValidationIssue } from "./errors.ts";
import type {
	WorkflowDocument,
	WorkflowEdge,
	WorkflowEdgeCondition,
	WorkflowNode,
	WorkflowNodeKind,
} from "./types.ts";

const ALLOWED_OUTGOING_EDGE_CONDITIONS: Record<
	WorkflowNodeKind,
	readonly WorkflowEdgeCondition[]
> = {
	trigger: ["always"],
	task: ["on_success", "on_failure"],
	check: ["on_success", "on_failure"],
	gate: ["on_approval"],
	artifact: ["on_success", "on_failure"],
	terminal: [],
};

export function appendExecutableGraphIssues(
	document: WorkflowDocument,
	issues: WorkflowValidationIssue[],
) {
	const edgesBySource = new Map<string, WorkflowEdge[]>();
	const edgesByTarget = new Map<string, WorkflowEdge[]>();
	const nodeIndexById = new Map(document.nodes.map((node, index) => [node.id, index]));
	const edgeIndexById = new Map(document.edges.map((edge, index) => [edge.id, index]));

	for (const edge of document.edges) {
		const outgoing = edgesBySource.get(edge.sourceId) ?? [];
		outgoing.push(edge);
		edgesBySource.set(edge.sourceId, outgoing);

		const incoming = edgesByTarget.get(edge.targetId) ?? [];
		incoming.push(edge);
		edgesByTarget.set(edge.targetId, incoming);
	}

	appendBoundaryNodeIssues({
		document,
		kind: "trigger",
		missingCode: "missing_trigger_node",
		multipleCode: "multiple_trigger_nodes",
		issues,
	});
	appendBoundaryNodeIssues({
		document,
		kind: "terminal",
		missingCode: "missing_terminal_node",
		multipleCode: "multiple_terminal_nodes",
		issues,
	});

	for (const [index, node] of document.nodes.entries()) {
		const incoming = edgesByTarget.get(node.id) ?? [];
		const distinctSourceCount = new Set(incoming.map((edge) => edge.sourceId)).size;
		if (distinctSourceCount > 1) {
			issues.push(
				createIssue(
					"multiple_incoming_edges",
					`$.nodes[${index}].id`,
					`Node "${node.id}" has multiple predecessor nodes, but merge execution is not supported in v1.`,
				),
			);
		}

		const outgoing = edgesBySource.get(node.id) ?? [];
		validateOutgoingEdges({
			node,
			outgoing,
			edgeIndexById,
			issues,
		});

		if ((node.kind === "trigger" || node.kind === "gate") && outgoing.length === 0) {
			issues.push(
				createIssue(
					"missing_required_transition",
					`$.nodes[${index}].id`,
					`Node "${node.id}" requires an outgoing transition in the v1 executable subset.`,
				),
			);
		}

		if (
			(node.kind === "task" || node.kind === "check" || node.kind === "artifact") &&
			!outgoing.some((edge) => edge.condition === "on_success")
		) {
			issues.push(
				createIssue(
					"missing_required_transition",
					`$.nodes[${index}].id`,
					`Node "${node.id}" requires an "on_success" transition in the v1 executable subset.`,
				),
			);
		}
	}

	appendCycleIssues({
		document,
		edgesBySource,
		edgesByTarget,
		nodeIndexById,
		issues,
	});
	appendUnreachableNodeIssues({
		document,
		edgesBySource,
		nodeIndexById,
		issues,
	});
}

function appendBoundaryNodeIssues(input: {
	document: WorkflowDocument;
	kind: "trigger" | "terminal";
	missingCode: "missing_trigger_node" | "missing_terminal_node";
	multipleCode: "multiple_trigger_nodes" | "multiple_terminal_nodes";
	issues: WorkflowValidationIssue[];
}) {
	const matchingNodes = input.document.nodes
		.map((node, index) => ({ node, index }))
		.filter(({ node }) => node.kind === input.kind);

	if (matchingNodes.length === 0) {
		input.issues.push(
			createIssue(
				input.missingCode,
				"$.nodes",
				`The executable workflow must define exactly one ${input.kind} node.`,
			),
		);
		return;
	}

	if (matchingNodes.length === 1) {
		return;
	}

	for (const { node, index } of matchingNodes.slice(1)) {
		input.issues.push(
			createIssue(
				input.multipleCode,
				`$.nodes[${index}].kind`,
				`Node "${node.id}" creates multiple ${input.kind} nodes, which is not supported in v1.`,
			),
		);
	}
}

function validateOutgoingEdges(input: {
	node: WorkflowNode;
	outgoing: WorkflowEdge[];
	edgeIndexById: Map<string, number>;
	issues: WorkflowValidationIssue[];
}) {
	const allowedConditions = ALLOWED_OUTGOING_EDGE_CONDITIONS[input.node.kind];
	const seenConditions = new Set<WorkflowEdgeCondition>();

	for (const edge of input.outgoing) {
		const edgeIndex = input.edgeIndexById.get(edge.id) ?? -1;
		const edgePath = edgeIndex >= 0 ? `$.edges[${edgeIndex}].condition` : "$.edges";

		if (!allowedConditions.includes(edge.condition)) {
			input.issues.push(
				createIssue(
					"invalid_edge_condition_for_node",
					edgePath,
					`Edge "${edge.id}" uses condition "${edge.condition}" from node "${input.node.id}", which is not supported for ${input.node.kind} nodes in v1.`,
				),
			);
		}

		if (seenConditions.has(edge.condition)) {
			input.issues.push(
				createIssue(
					"duplicate_outgoing_condition",
					edgePath,
					`Node "${input.node.id}" has multiple outgoing "${edge.condition}" edges, which would create fan-out in v1.`,
				),
			);
			continue;
		}

		seenConditions.add(edge.condition);
	}
}

function appendCycleIssues(input: {
	document: WorkflowDocument;
	edgesBySource: Map<string, WorkflowEdge[]>;
	edgesByTarget: Map<string, WorkflowEdge[]>;
	nodeIndexById: Map<string, number>;
	issues: WorkflowValidationIssue[];
}) {
	const remainingIncomingByNodeId = new Map(
		input.document.nodes.map((node) => [node.id, (input.edgesByTarget.get(node.id) ?? []).length]),
	);
	const readyNodeIds = input.document.nodes
		.filter((node) => (remainingIncomingByNodeId.get(node.id) ?? 0) === 0)
		.map((node) => node.id);
	let processedNodeCount = 0;

	while (readyNodeIds.length > 0) {
		const nodeId = readyNodeIds.shift();
		if (!nodeId) {
			continue;
		}
		processedNodeCount += 1;
		for (const edge of input.edgesBySource.get(nodeId) ?? []) {
			const remainingIncoming = (remainingIncomingByNodeId.get(edge.targetId) ?? 0) - 1;
			remainingIncomingByNodeId.set(edge.targetId, remainingIncoming);
			if (remainingIncoming === 0) {
				readyNodeIds.push(edge.targetId);
			}
		}
	}

	if (processedNodeCount === input.document.nodes.length) {
		return;
	}

	for (const node of input.document.nodes) {
		if ((remainingIncomingByNodeId.get(node.id) ?? 0) <= 0) {
			continue;
		}
		const nodeIndex = input.nodeIndexById.get(node.id);
		input.issues.push(
			createIssue(
				"cycle_detected",
				typeof nodeIndex === "number" ? `$.nodes[${nodeIndex}].id` : "$.nodes",
				`Node "${node.id}" participates in or depends on a cycle, which is not supported in v1.`,
			),
		);
	}
}

function appendUnreachableNodeIssues(input: {
	document: WorkflowDocument;
	edgesBySource: Map<string, WorkflowEdge[]>;
	nodeIndexById: Map<string, number>;
	issues: WorkflowValidationIssue[];
}) {
	const triggerNodes = input.document.nodes.filter((node) => node.kind === "trigger");
	if (triggerNodes.length !== 1) {
		return;
	}

	const visitedNodeIds = new Set<string>();
	const pendingNodeIds = [triggerNodes[0]!.id];

	while (pendingNodeIds.length > 0) {
		const nodeId = pendingNodeIds.pop();
		if (!nodeId || visitedNodeIds.has(nodeId)) {
			continue;
		}
		visitedNodeIds.add(nodeId);
		for (const edge of input.edgesBySource.get(nodeId) ?? []) {
			pendingNodeIds.push(edge.targetId);
		}
	}

	for (const node of input.document.nodes) {
		if (visitedNodeIds.has(node.id)) {
			continue;
		}
		const nodeIndex = input.nodeIndexById.get(node.id);
		input.issues.push(
			createIssue(
				"unreachable_node",
				typeof nodeIndex === "number" ? `$.nodes[${nodeIndex}].id` : "$.nodes",
				`Node "${node.id}" is not reachable from the workflow trigger.`,
			),
		);
	}
}
