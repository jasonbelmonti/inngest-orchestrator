import { describe, expect, test } from "bun:test";
import { compileWorkflowDocument } from "./compiler.ts";
import { WorkflowStore } from "./store.ts";
import { EXAMPLE_CONFIG_ROOT, makeRepositoryCatalog, makeWorkflow } from "./test-fixtures.ts";
import type { WorkflowDocument } from "./types.ts";

describe("compileWorkflowDocument", () => {
	test("compiles the example workflow into the supported executable subset", async () => {
		const store = await WorkflowStore.open({ configRoot: EXAMPLE_CONFIG_ROOT });
		const record = await store.readWorkflow("cross-repo-bugfix");

		const compiled = compileWorkflowDocument({
			document: record.document,
			repoCatalog: record.repoCatalog,
		});

		expect(compiled.workflowId).toBe("cross-repo-bugfix");
		expect(
			compiled.repositories.find((repository) => repository.id === "agent-console")
				?.label,
		).toBe("Agent Console");
		expect(
			compiled.nodes.find((node) => node.id === "implement"),
		).toMatchObject({
			kind: "task",
			template: "task.agent",
			target: {
				repoId: "agent-console",
				worktreeStrategy: "shared",
			},
		});
	});

	test("rejects unsupported templates with machine-readable issue codes", () => {
		const workflow: WorkflowDocument = {
			schemaVersion: 1,
			workflowId: "unsupported-template",
			name: "Unsupported Template",
			repositories: [{ id: "agent-console", required: true }],
			phases: [{ id: "implementation", label: "Implementation", order: 1 }],
			nodes: [
				{
					id: "implement",
					kind: "task",
					label: "Implement",
					phaseId: "implementation",
					target: { repoId: "agent-console" },
					settings: { template: "task.unstable" },
				},
			],
			edges: [],
		};

		expect(() =>
			compileWorkflowDocument({
				document: workflow,
				repoCatalog: {
					schemaVersion: 1,
					repositories: [{ id: "agent-console", label: "Agent Console" }],
				},
			}),
		).toThrow(
			expect.objectContaining({
				code: "invalid_executable_workflow",
				issues: expect.arrayContaining([
					expect.objectContaining({ code: "unsupported_template" }),
					]),
				}),
			);
	});

	test("rejects fan-out and merge shapes with machine-readable issue codes", () => {
		const workflow = makeWorkflow({
			nodes: [
				...makeWorkflow().nodes,
				{
					id: "remediate",
					kind: "task",
					label: "Remediate",
					phaseId: "implementation",
					target: { repoId: "agent-console" },
					settings: {
						template: "task.agent",
						prompt: "Triage the failure and prepare a fallback patch.",
					},
				},
			],
			edges: [
				...makeWorkflow().edges,
				{
					id: "edge-implement-terminal-duplicate-success",
					sourceId: "implement",
					targetId: "terminal",
					condition: "on_success",
				},
				{
					id: "edge-implement-remediate",
					sourceId: "implement",
					targetId: "remediate",
					condition: "on_failure",
				},
				{
					id: "edge-remediate-typecheck",
					sourceId: "remediate",
					targetId: "typecheck",
					condition: "on_success",
				},
			],
		});

		expect(() =>
			compileWorkflowDocument({
				document: workflow,
				repoCatalog: makeRepositoryCatalog(),
			}),
		).toThrow(
			expect.objectContaining({
				code: "invalid_executable_workflow",
				issues: expect.arrayContaining([
					expect.objectContaining({ code: "duplicate_outgoing_condition" }),
					expect.objectContaining({ code: "multiple_incoming_edges" }),
				]),
			}),
		);
	});

		test("rejects cycles and unreachable nodes with machine-readable issue codes", () => {
		const baseWorkflow = makeWorkflow();
		const [firstBaseEdge, secondBaseEdge] = baseWorkflow.edges;
		if (!firstBaseEdge || !secondBaseEdge) {
			throw new Error("Invalid base workflow fixture.");
		}

		const workflow = makeWorkflow({
			nodes: [
				...baseWorkflow.nodes,
				{
					id: "orphan",
					kind: "task",
					label: "Orphan",
					phaseId: "implementation",
					target: { repoId: "agent-console" },
					settings: {
						template: "task.agent",
						prompt: "This node should never be reachable.",
					},
				},
			],
			edges: [
					firstBaseEdge,
					secondBaseEdge,
				{
					id: "edge-typecheck-implement-cycle",
					sourceId: "typecheck",
					targetId: "implement",
					condition: "on_success",
				},
			],
		});

		expect(() =>
			compileWorkflowDocument({
				document: workflow,
				repoCatalog: makeRepositoryCatalog(),
			}),
		).toThrow(
			expect.objectContaining({
				code: "invalid_executable_workflow",
				issues: expect.arrayContaining([
					expect.objectContaining({ code: "cycle_detected" }),
					expect.objectContaining({ code: "unreachable_node" }),
				]),
				}),
			);
	});

	test("rejects step nodes that do not define a success transition", () => {
		const workflow = makeWorkflow({
			edges: [
				{
					id: "edge-trigger-implement",
					sourceId: "trigger",
					targetId: "implement",
					condition: "always",
				},
				{
					id: "edge-implement-terminal-on-failure",
					sourceId: "implement",
					targetId: "terminal",
					condition: "on_failure",
				},
			],
		});

		expect(() =>
			compileWorkflowDocument({
				document: workflow,
				repoCatalog: makeRepositoryCatalog(),
			}),
		).toThrow(
			expect.objectContaining({
				code: "invalid_executable_workflow",
				issues: expect.arrayContaining([
					expect.objectContaining({ code: "missing_required_transition" }),
				]),
			}),
		);
	});
});
