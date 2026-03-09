import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveWorkflowDocument, validateWorkflowDocumentInput } from "./authoring.ts";
import { serializeWorkflowRepositoryCatalog } from "./serialization.ts";
import { WorkflowStore } from "./store.ts";
import { makeRepositoryCatalog, makeWorkflow } from "./test-fixtures.ts";

const tempConfigRoots: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempConfigRoots.map((directory) =>
			rm(directory, { recursive: true, force: true }),
		),
	);
	tempConfigRoots.length = 0;
});

describe("workflow authoring", () => {
	test("validates stdin workflow documents against the config root", async () => {
		const configRoot = await createTempConfigRoot();
		const store = await WorkflowStore.open({ configRoot });

		const result = await validateWorkflowDocumentInput({
			store,
			document: makeWorkflow(),
		});

		expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
		expect(result.compiled.workflowId).toBe("cross-repo-bugfix");
		expect(result.filePath).toBe("memory://stdin/workflow.json");
	});

	test("saves a new workflow when no prior record exists", async () => {
		const configRoot = await createTempConfigRoot();
		const store = await WorkflowStore.open({ configRoot });
		const workflow = makeWorkflow({
			workflowId: "ship-feature",
			name: "Ship Feature",
		});

		const save = await saveWorkflowDocument({
			store,
			options: {
				document: workflow,
			},
		});

		expect(save.operation).toBe("created");
		expect(save.workflow.workflowId).toBe("ship-feature");
		expect(save.workflow.filePath).toContain("/workflows/ship-feature.json");
	});

	test("fails closed when updating an existing workflow without a baseline hash", async () => {
		const configRoot = await createTempConfigRoot({
			workflows: {
				"cross-repo-bugfix": makeWorkflow(),
			},
		});
		const store = await WorkflowStore.open({ configRoot });

		await expect(
			saveWorkflowDocument({
				store,
				options: {
					document: makeWorkflow({
						name: "Cross-Repo Bugfix Updated",
					}),
				},
			}),
		).rejects.toMatchObject({
			code: "workflow_save_conflict",
		});
	});

	test("fails closed when the optimistic save hash is stale", async () => {
		const configRoot = await createTempConfigRoot({
			workflows: {
				"cross-repo-bugfix": makeWorkflow(),
			},
		});
		const store = await WorkflowStore.open({ configRoot });

		await expect(
			saveWorkflowDocument({
				store,
				options: {
					document: makeWorkflow({
						name: "Cross-Repo Bugfix Updated",
					}),
					expectedContentHash: "deadbeef",
				},
			}),
		).rejects.toMatchObject({
			code: "workflow_save_conflict",
		});
	});

	test("updates an existing workflow when the optimistic save hash matches", async () => {
		const configRoot = await createTempConfigRoot({
			workflows: {
				"cross-repo-bugfix": makeWorkflow(),
			},
		});
		const store = await WorkflowStore.open({ configRoot });
		const existing = await store.readWorkflow("cross-repo-bugfix");

		const save = await saveWorkflowDocument({
			store,
			options: {
				document: makeWorkflow({
					name: "Cross-Repo Bugfix Updated",
				}),
				expectedContentHash: existing.contentHash,
				filePath: existing.filePath,
			},
		});

		expect(save.operation).toBe("updated");
		expect(save.workflow.name).toBe("Cross-Repo Bugfix Updated");
	});
});

async function createTempConfigRoot(input?: {
	workflows?: Record<string, unknown>;
}) {
	const root = await mkdtemp(join(tmpdir(), "inngest-orchestrator-io-02-"));
	tempConfigRoots.push(root);

	const reposDirectory = join(root, "repos");
	const workflowsDirectory = join(root, "workflows");
	await mkdir(reposDirectory, { recursive: true });
	await mkdir(workflowsDirectory, { recursive: true });

	await Bun.write(
		join(reposDirectory, "workspace.repos.json"),
		serializeWorkflowRepositoryCatalog(makeRepositoryCatalog()),
	);

	for (const [fileName, workflow] of Object.entries(input?.workflows ?? {})) {
		await Bun.write(
			join(workflowsDirectory, `${fileName}.json`),
			`${JSON.stringify(workflow, null, 2)}\n`,
		);
	}

	return root;
}
