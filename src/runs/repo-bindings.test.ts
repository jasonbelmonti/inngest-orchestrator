import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { serializeWorkflowRepositoryCatalog } from "../workflows/serialization.ts";
import { makeRepositoryCatalog, makeWorkflow } from "../workflows/test-fixtures.ts";
import { resolveRunLaunchRequest } from "./repo-bindings.ts";

const tempDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempDirectories.map((directory) =>
			rm(directory, { recursive: true, force: true }),
		),
	);
	tempDirectories.length = 0;
});

describe("resolveRunLaunchRequest", () => {
	test("resolves declared repo bindings into a deterministic normalized snapshot", async () => {
		const configRoot = await createTempConfigRoot({
			workflows: {
				"cross-repo-bugfix": makeWorkflow({
					repositories: [
						{ id: "agent-console", required: true },
						{ id: "inngest-orchestrator", required: false },
					],
				}),
			},
		});
		const agentConsolePath = await createTempDirectory("agent-console");
		const orchestratorPath = await createTempDirectory("inngest-runtime");

		const result = await resolveRunLaunchRequest({
			workflowId: "cross-repo-bugfix",
			configRoot,
			repoBindings: {
				"inngest-orchestrator": orchestratorPath,
				"agent-console": agentConsolePath,
			},
		});

		expect(result).toEqual({
			configRoot,
			workflow: expect.objectContaining({
				workflowId: "cross-repo-bugfix",
				name: "Cross-Repo Bugfix",
				contentHash: expect.any(String),
				filePath: expect.stringContaining("/workflows/cross-repo-bugfix.json"),
			}),
				repoBindings: [
					{
						repoId: "agent-console",
						label: "Agent Console",
						required: true,
						status: "resolved",
						resolvedPath: agentConsolePath,
					},
					{
						repoId: "inngest-orchestrator",
						label: "Inngest Orchestrator",
						required: false,
						status: "resolved",
						resolvedPath: orchestratorPath,
				},
			],
		});
	});

	test("normalizes equivalent repo-binding payloads deterministically", async () => {
		const configRoot = await createTempConfigRoot({
			workflows: {
				"cross-repo-bugfix": makeWorkflow({
					repositories: [
						{ id: "agent-console", required: true },
						{ id: "inngest-orchestrator", required: false },
					],
				}),
			},
		});
		const agentConsolePath = await createTempDirectory("agent-console");
		const orchestratorPath = await createTempDirectory("inngest-runtime");

		const first = await resolveRunLaunchRequest({
			workflowId: "cross-repo-bugfix",
			configRoot,
			repoBindings: {
				"agent-console": agentConsolePath,
				"inngest-orchestrator": orchestratorPath,
			},
		});
		const second = await resolveRunLaunchRequest({
			workflowId: "cross-repo-bugfix",
			configRoot,
			repoBindings: {
				"inngest-orchestrator": orchestratorPath,
				"agent-console": agentConsolePath,
			},
		});

		expect(second).toEqual(first);
	});

	test("marks optional repo bindings as unbound when omitted", async () => {
		const configRoot = await createTempConfigRoot({
			workflows: {
				"cross-repo-bugfix": makeWorkflow({
					repositories: [
						{ id: "agent-console", required: true },
						{ id: "inngest-orchestrator", required: false },
					],
				}),
			},
		});
		const agentConsolePath = await createTempDirectory("agent-console");

		const result = await resolveRunLaunchRequest({
			workflowId: "cross-repo-bugfix",
			configRoot,
			repoBindings: {
				"agent-console": agentConsolePath,
			},
		});

		expect(result.repoBindings).toEqual([
			{
				repoId: "agent-console",
				label: "Agent Console",
				required: true,
				status: "resolved",
				resolvedPath: agentConsolePath,
			},
			{
				repoId: "inngest-orchestrator",
				label: "Inngest Orchestrator",
				required: false,
				status: "unbound_optional",
				resolvedPath: null,
			},
		]);
	});

	test("fails closed when required repo bindings are missing", async () => {
		const configRoot = await createTempConfigRoot();

		await expect(
			resolveRunLaunchRequest({
				workflowId: "cross-repo-bugfix",
				configRoot,
				repoBindings: {},
			}),
		).rejects.toMatchObject({
			code: "repo_binding_resolution_failed",
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "missing_required_repo_binding",
					path: "$.repoBindings.agent-console",
				}),
			]),
		});
	});

	test("fails closed when repo bindings mention undeclared repo ids", async () => {
		const configRoot = await createTempConfigRoot();
		const agentConsolePath = await createTempDirectory("agent-console");
		const extraPath = await createTempDirectory("unknown-repo");

		await expect(
			resolveRunLaunchRequest({
				workflowId: "cross-repo-bugfix",
				configRoot,
				repoBindings: {
					"agent-console": agentConsolePath,
					"inngest-orchestrator": extraPath,
					"claudex": extraPath,
				},
			}),
		).rejects.toMatchObject({
			code: "repo_binding_resolution_failed",
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "unknown_repo_binding",
					path: "$.repoBindings.claudex",
				}),
			]),
		});
	});

	test("rejects malformed repo binding payloads before resolution", async () => {
		const configRoot = await createTempConfigRoot();

		await expect(
			resolveRunLaunchRequest({
				workflowId: "cross-repo-bugfix",
				configRoot,
				repoBindings: {
					"agent-console": "",
				},
			}),
		).rejects.toMatchObject({
			code: "invalid_run_launch_input",
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "invalid_shape",
					path: "$.repoBindings.agent-console",
				}),
			]),
		});
	});

	test("rejects malformed top-level launch payloads", async () => {
		await expect(resolveRunLaunchRequest("not-an-object")).rejects.toMatchObject({
			code: "invalid_run_launch_input",
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "invalid_shape",
					path: "$",
				}),
			]),
		});
	});

	test("rejects non-absolute repo binding paths", async () => {
		const configRoot = await createTempConfigRoot();
		const orchestratorPath = await createTempDirectory("inngest-runtime");

		await expect(
			resolveRunLaunchRequest({
				workflowId: "cross-repo-bugfix",
				configRoot,
				repoBindings: {
					"agent-console": "./relative/path",
					"inngest-orchestrator": orchestratorPath,
				},
			}),
		).rejects.toMatchObject({
			code: "repo_binding_resolution_failed",
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "repo_binding_path_not_absolute",
					path: "$.repoBindings.agent-console",
				}),
			]),
		});
	});

	test("rejects repo binding paths that do not point to existing directories", async () => {
		const configRoot = await createTempConfigRoot();
		const missingPath = join(await createTempDirectory("bindings-root"), "missing");
		const notDirectoryPath = join(await createTempDirectory("bindings-root"), "file.txt");
		await Bun.write(notDirectoryPath, "not a directory\n");

		await expect(
			resolveRunLaunchRequest({
				workflowId: "cross-repo-bugfix",
				configRoot,
				repoBindings: {
					"agent-console": missingPath,
					"inngest-orchestrator": notDirectoryPath,
				},
			}),
		).rejects.toMatchObject({
			code: "repo_binding_resolution_failed",
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "repo_binding_path_not_found",
					path: "$.repoBindings.agent-console",
				}),
				expect.objectContaining({
					code: "repo_binding_path_not_directory",
					path: "$.repoBindings.inngest-orchestrator",
				}),
			]),
		});
	});
});

async function createTempConfigRoot(input?: {
	workflows?: Record<string, unknown>;
}) {
	const root = await createTempDirectory("inngest-orchestrator-runs-");
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

	if (!input?.workflows) {
		await Bun.write(
			join(workflowsDirectory, "cross-repo-bugfix.json"),
			`${JSON.stringify(makeWorkflow(), null, 2)}\n`,
		);
	}

	return root;
}

async function createTempDirectory(prefix: string) {
	const directory = await mkdtemp(join(tmpdir(), prefix));
	tempDirectories.push(directory);
	return directory;
}
