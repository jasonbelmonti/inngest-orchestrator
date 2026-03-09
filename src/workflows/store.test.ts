import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { WorkflowError } from "./errors.ts";
import {
	hashWorkflowDocument,
	serializeWorkflowDocument,
	serializeWorkflowRepositoryCatalog,
} from "./serialization.ts";
import { WorkflowStore } from "./store.ts";
import type {
	WorkflowDocument,
	WorkflowRepositoryCatalog,
	WorkflowSummary,
} from "./types.ts";
import { parseWorkflowDocument } from "./validation.ts";

const EXAMPLE_CONFIG_ROOT = resolve(import.meta.dir, "../../examples/config-root");
const tempConfigRoots: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempConfigRoots.map((directory) =>
			rm(directory, { recursive: true, force: true }),
		),
	);
	tempConfigRoots.length = 0;
});

describe("WorkflowStore", () => {
	test("loads the example config root and round-trips the canonical workflow document", async () => {
		const store = await WorkflowStore.open({ configRoot: EXAMPLE_CONFIG_ROOT });

		const summaries = await store.listWorkflows();
		expect(summaries).toHaveLength(1);
		expectSummaryShape(summaries[0]);
		expect(summaries[0]?.workflowId).toBe("cross-repo-bugfix");

		const record = await store.readWorkflow("cross-repo-bugfix");
		const roundTrip = parseWorkflowDocument(
			JSON.parse(serializeWorkflowDocument(record.document)),
			{
				filePath: "memory://cross-repo-bugfix",
				repoCatalog: record.repoCatalog,
			},
		);

		expect(roundTrip).toEqual(record.document);
		expect(hashWorkflowDocument(roundTrip)).toBe(record.contentHash);
	});

	test("returns workflow summaries in deterministic workflowId order", async () => {
		const configRoot = await createTempConfigRoot({
			workflows: {
				"99-zeta": makeWorkflow({
					workflowId: "zeta",
					name: "Zeta",
				}),
				"01-alpha": makeWorkflow({
					workflowId: "alpha",
					name: "Alpha",
				}),
			},
		});

		const store = await WorkflowStore.open({ configRoot });
		const summaries = await store.listWorkflows();
		expect(summaries.map((summary) => summary.workflowId)).toEqual([
			"alpha",
			"zeta",
		]);
	});

	test("rejects duplicate node ids with machine-readable issue codes", async () => {
		const configRoot = await createTempConfigRoot({
			workflows: {
				duplicate: makeWorkflow({
					nodes: [
						makeWorkflow().nodes[0]!,
						{
							...makeWorkflow().nodes[1]!,
							id: "duplicate",
						},
						{
							...makeWorkflow().nodes[2]!,
							id: "duplicate",
						},
						makeWorkflow().nodes[3]!,
					],
				}),
			},
		});

		const store = await WorkflowStore.open({ configRoot });
		await expect(store.listWorkflows()).rejects.toMatchObject({
			code: "invalid_workflow_document",
			issues: expect.arrayContaining([
				expect.objectContaining({ code: "duplicate_node_id" }),
			]),
		});
	});

	test("rejects missing references with machine-readable issue codes", async () => {
		const brokenWorkflow = makeWorkflow({
			edges: [
				{
					id: "edge-trigger-missing",
					sourceId: "trigger",
					targetId: "missing-node",
					condition: "always",
				},
			],
		});
		const configRoot = await createTempConfigRoot({
			workflows: {
				broken: brokenWorkflow,
			},
		});

		const store = await WorkflowStore.open({ configRoot });
		await expect(store.listWorkflows()).rejects.toMatchObject({
			code: "invalid_workflow_document",
			issues: expect.arrayContaining([
				expect.objectContaining({ code: "missing_node" }),
			]),
		});
	});

	test("rejects repo-targeted nodes that omit a required repo target", async () => {
		const workflow = makeWorkflow();
		const brokenWorkflow = {
			...workflow,
			nodes: workflow.nodes.map((node) =>
				node.id === "implement" ? { ...node, target: undefined } : node,
			),
		};
		const configRoot = await createTempConfigRoot({
			workflows: {
				broken: brokenWorkflow,
			},
		});

		const store = await WorkflowStore.open({ configRoot });
		await expect(store.listWorkflows()).rejects.toMatchObject({
			code: "invalid_workflow_document",
			issues: expect.arrayContaining([
				expect.objectContaining({ code: "missing_repo_target" }),
			]),
		});
	});

	test("serializes equivalent workflow objects with stable key ordering and hash output", () => {
		const left = makeWorkflow();
		const right: WorkflowDocument = {
			workflowId: left.workflowId,
			summary: left.summary,
			schemaVersion: left.schemaVersion,
			name: left.name,
			edges: left.edges,
			nodes: left.nodes.map((node) =>
				node.id === "implement"
					? {
							...node,
							settings: {
								prompt: "Patch the bug and summarize the diff.",
								template: "task.agent",
							},
					  }
					: node,
			),
			phases: left.phases,
			repositories: left.repositories,
		};

		expect(serializeWorkflowDocument(left)).toBe(serializeWorkflowDocument(right));
		expect(hashWorkflowDocument(left)).toBe(hashWorkflowDocument(right));
	});
});

function expectSummaryShape(summary: WorkflowSummary | undefined) {
	expect(summary).toBeDefined();
	expect(summary?.contentHash).toMatch(/^[0-9a-f]{64}$/);
	expect(summary?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	expect(summary?.nodeCount).toBeGreaterThan(0);
	expect(summary?.edgeCount).toBeGreaterThan(0);
	expect(summary?.filePath).toContain("/workflows/");
}

async function createTempConfigRoot(input: {
	repoCatalog?: WorkflowRepositoryCatalog;
	workflows: Record<string, WorkflowDocument>;
}) {
	const root = await mkdtemp(join(tmpdir(), "inngest-orchestrator-io-01-"));
	tempConfigRoots.push(root);

	const repoCatalog = input.repoCatalog ?? makeRepositoryCatalog();
	const reposDirectory = join(root, "repos");
	const workflowsDirectory = join(root, "workflows");
	await mkdir(reposDirectory, { recursive: true });
	await mkdir(workflowsDirectory, { recursive: true });

	await Bun.write(
		join(reposDirectory, "workspace.repos.json"),
		serializeWorkflowRepositoryCatalog(repoCatalog),
	);

	for (const [fileName, workflow] of Object.entries(input.workflows)) {
		await Bun.write(
			join(workflowsDirectory, `${fileName}.json`),
			serializeWorkflowDocument(workflow),
		);
	}

	return root;
}

function makeRepositoryCatalog(): WorkflowRepositoryCatalog {
	return {
		schemaVersion: 1,
		repositories: [
			{ id: "agent-console", label: "Agent Console" },
			{ id: "inngest-orchestrator", label: "Inngest Orchestrator" },
		],
	};
}

function makeWorkflow(
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
