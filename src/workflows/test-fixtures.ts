import { resolve } from "node:path";
import type { WorkflowDocument, WorkflowRepositoryCatalog } from "./types.ts";

export const EXAMPLE_CONFIG_ROOT = resolve(
	import.meta.dir,
	"../../examples/config-root",
);

export function makeRepositoryCatalog(): WorkflowRepositoryCatalog {
	return {
		schemaVersion: 1,
		repositories: [
			{ id: "agent-console", label: "Agent Console" },
			{ id: "inngest-orchestrator", label: "Inngest Orchestrator" },
		],
	};
}

export function makeWorkflow(
	overrides: Partial<WorkflowDocument> = {},
): WorkflowDocument {
	const workflow: WorkflowDocument = {
		schemaVersion: 1,
		workflowId: "cross-repo-bugfix",
		name: "Cross-Repo Bugfix",
		summary: "Example workflow for IO-01 tests.",
		repositories: [
			{ id: "agent-console", required: true },
			{ id: "inngest-orchestrator", required: true },
		],
		phases: [
			{ id: "intake", label: "Intake", order: 1 },
			{ id: "implementation", label: "Implementation", order: 2 },
			{ id: "output", label: "Output", order: 3 },
		],
		nodes: [
			{
				id: "trigger",
				kind: "trigger",
				label: "Manual Trigger",
				phaseId: "intake",
				settings: { template: "trigger.manual" },
			},
			{
				id: "implement",
				kind: "task",
				label: "Implement",
				phaseId: "implementation",
				target: { repoId: "agent-console" },
				settings: {
					template: "task.agent",
					prompt: "Patch the bug and summarize the diff.",
				},
			},
			{
				id: "typecheck",
				kind: "check",
				label: "Typecheck",
				phaseId: "output",
				target: { repoId: "agent-console" },
				settings: {
					template: "check.shell",
					command: "bun run typecheck",
				},
			},
			{
				id: "terminal",
				kind: "terminal",
				label: "Done",
				phaseId: "output",
				settings: { template: "terminal.complete" },
			},
		],
		edges: [
			{
				id: "edge-trigger-implement",
				sourceId: "trigger",
				targetId: "implement",
				condition: "always",
			},
			{
				id: "edge-implement-typecheck",
				sourceId: "implement",
				targetId: "typecheck",
				condition: "on_success",
			},
			{
				id: "edge-typecheck-terminal",
				sourceId: "typecheck",
				targetId: "terminal",
				condition: "on_success",
			},
		],
	};

	return {
		...workflow,
		...overrides,
	};
}
