import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { compileWorkflowDocument } from "./compiler.ts";
import { WorkflowStore } from "./store.ts";
import type { WorkflowDocument } from "./types.ts";

const EXAMPLE_CONFIG_ROOT = resolve(import.meta.dir, "../../examples/config-root");

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
});
