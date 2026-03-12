import { describe, expect, test } from "bun:test";
import {
	EXAMPLE_CONFIG_ROOT,
	makeRepositoryCatalog,
	makeWorkflow,
} from "../workflows/test-fixtures.ts";
import { createRuntimeExecutionPlan } from "./execution-plan.ts";
import { RuntimePlanError } from "./errors.ts";

describe("createRuntimeExecutionPlan", () => {
	test("compiles the example workflow into BEL-371 runtime steps", () => {
		const plan = createRuntimeExecutionPlan({
			run: {
				runId: "run-001",
				launch: makeResolvedLaunch(),
			},
			workflowRecord: makeWorkflowRecord(makeWorkflow()),
		});

		expect(plan).toEqual({
			runId: "run-001",
			workflowId: "cross-repo-bugfix",
			workflowName: "Cross-Repo Bugfix",
			steps: [
				{
					id: "implement",
					kind: "task",
					template: "task.agent",
					label: "Implement",
					target: {
						repoId: "agent-console",
						resolvedPath: "/tmp/agent-console",
						worktreeStrategy: "shared",
					},
					prompt: "Patch the bug and summarize the diff.",
				},
				{
					id: "typecheck",
					kind: "check",
					template: "check.shell",
					label: "Typecheck",
					target: {
						repoId: "agent-console",
						resolvedPath: "/tmp/agent-console",
						worktreeStrategy: "shared",
					},
					command: "bun run typecheck",
				},
				{
					id: "terminal",
					kind: "terminal",
					template: "terminal.complete",
					label: "Done",
				},
			],
		});
	});

	test("rejects unsupported BEL-371 templates", async () => {
		const baseNodes = makeWorkflow().nodes;
		const triggerNode = baseNodes.find((node) => node.id === "trigger");
		const implementNode = baseNodes.find((node) => node.id === "implement");
		const terminalNode = baseNodes.find((node) => node.id === "terminal");
		if (!triggerNode || !implementNode || !terminalNode) {
			throw new Error("Invalid workflow fixture for BEL-371 test.");
		}

		const workflow = makeWorkflow({
			nodes: [
				triggerNode,
				implementNode,
				{
					id: "approve",
					kind: "gate",
					label: "Approve",
					phaseId: "output",
					settings: { template: "gate.approval" },
				},
				terminalNode,
			],
			edges: [
				{
					id: "edge-trigger-implement",
					sourceId: "trigger",
					targetId: "implement",
					condition: "always",
				},
				{
					id: "edge-implement-approve",
					sourceId: "implement",
					targetId: "approve",
					condition: "on_success",
				},
				{
					id: "edge-approve-terminal",
					sourceId: "approve",
					targetId: "terminal",
					condition: "on_approval",
				},
			],
		});

		expect(() =>
			createRuntimeExecutionPlan({
				run: {
					runId: "run-002",
					launch: makeResolvedLaunch(),
				},
				workflowRecord: makeWorkflowRecord(workflow),
			}),
		).toThrow(
			expect.objectContaining({
				code: "invalid_runtime_execution_plan",
				issues: expect.arrayContaining([
					expect.objectContaining({
						code: "unsupported_runtime_template",
					}),
				]),
			}),
		);
	});

	test("rejects missing BEL-371 runtime settings", () => {
		const workflow = makeWorkflow({
			nodes: makeWorkflow().nodes.map((node) =>
				node.id === "typecheck"
					? {
							...node,
							settings: {
								...node.settings,
								command: "",
							},
						}
					: node,
			),
		});

		expect(() =>
			createRuntimeExecutionPlan({
				run: {
					runId: "run-003",
					launch: makeResolvedLaunch(),
				},
				workflowRecord: makeWorkflowRecord(workflow),
			}),
		).toThrow(
			expect.objectContaining({
				code: "invalid_runtime_execution_plan",
				issues: expect.arrayContaining([
					expect.objectContaining({
						code: "invalid_runtime_setting",
					}),
				]),
			}),
		);
	});

	test("rejects repo-target steps without a resolved local path", () => {
		expect(() =>
			createRuntimeExecutionPlan({
				run: {
					runId: "run-004",
					launch: {
						...makeResolvedLaunch(),
						repoBindings: [
							{
								repoId: "inngest-orchestrator",
								label: "Inngest Orchestrator",
								required: true,
								status: "resolved" as const,
								resolvedPath: "/tmp/inngest-orchestrator",
							},
						],
					},
				},
				workflowRecord: makeWorkflowRecord(makeWorkflow()),
			}),
		).toThrow(RuntimePlanError);
	});

	test("rejects workflow snapshot mismatches before planning", () => {
		expect(() =>
			createRuntimeExecutionPlan({
				run: {
					runId: "run-005",
					launch: {
						...makeResolvedLaunch(),
						workflow: {
							...makeResolvedLaunch().workflow,
							contentHash: "stale-hash",
							workflowId: "stale-workflow",
						},
					},
				},
				workflowRecord: makeWorkflowRecord(makeWorkflow()),
			}),
		).toThrow(
			expect.objectContaining({
				code: "invalid_runtime_execution_plan",
				issues: expect.arrayContaining([
					expect.objectContaining({
						code: "workflow_snapshot_mismatch",
						path: "$.launch.workflow.workflowId",
					}),
					expect.objectContaining({
						code: "workflow_snapshot_mismatch",
						path: "$.launch.workflow.contentHash",
					}),
				]),
			}),
		);
	});
});

function makeResolvedLaunch() {
	return {
		configRoot: EXAMPLE_CONFIG_ROOT,
		workflow: {
			workflowId: "cross-repo-bugfix",
			name: "Cross-Repo Bugfix",
			summary: "Example workflow for IO-01 tests.",
			contentHash: "content-hash",
			filePath: `${EXAMPLE_CONFIG_ROOT}/workflows/cross-repo-bugfix.json`,
		},
		repoBindings: [
			{
				repoId: "agent-console",
				label: "Agent Console",
				required: true,
				status: "resolved" as const,
				resolvedPath: "/tmp/agent-console",
			},
			{
				repoId: "inngest-orchestrator",
				label: "Inngest Orchestrator",
				required: true,
				status: "resolved" as const,
				resolvedPath: "/tmp/inngest-orchestrator",
			},
		],
	};
}

function makeWorkflowRecord(document: ReturnType<typeof makeWorkflow>) {
	return {
		workflowId: document.workflowId,
		name: document.name,
		summary: document.summary,
		updatedAt: "2026-03-12T00:00:00.000Z",
		nodeCount: document.nodes.length,
		edgeCount: document.edges.length,
		contentHash: "content-hash",
		filePath: `${EXAMPLE_CONFIG_ROOT}/workflows/${document.workflowId}.json`,
		document,
		repoCatalog: makeRepositoryCatalog(),
	};
}
