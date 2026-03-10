import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
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

		await expect(resolveRunLaunchRequest([])).rejects.toMatchObject({
			code: "invalid_run_launch_input",
			issues: [
				expect.objectContaining({
					code: "invalid_shape",
					path: "$",
				}),
			],
		});
	});

	test("wraps missing config-root failures in the run-launch error model", async () => {
		await expect(
			resolveRunLaunchRequest({
				workflowId: "cross-repo-bugfix",
				configRoot: join(await createTempDirectory("missing-config-root"), "missing"),
				repoBindings: {},
			}),
		).rejects.toMatchObject({
			code: "invalid_run_launch_input",
			issues: [
				expect.objectContaining({
					code: "config_root_invalid",
					path: "$.configRoot",
				}),
			],
		});
	});

	test("wraps missing workflow failures in the run-launch error model", async () => {
		const configRoot = await createTempConfigRoot();

		await expect(
			resolveRunLaunchRequest({
				workflowId: "missing-workflow",
				configRoot,
				repoBindings: {},
			}),
		).rejects.toMatchObject({
			code: "invalid_run_launch_input",
			issues: [
				expect.objectContaining({
					code: "workflow_not_found",
					path: "$.workflowId",
				}),
			],
		});
	});
	test("reports broken repository catalog as config-root invalid even when workflow files exist", async () => {
		const configRoot = await createTempConfigRoot({
			workflows: {
				"unrelated-workflow": makeWorkflow({
					workflowId: "unrelated-workflow",
					name: "Unrelated Workflow",
				}),
			},
		});
		await Bun.write(
			join(configRoot, "repos", "workspace.repos.json"),
			"{ invalid json\n",
		);

		await expect(
			resolveRunLaunchRequest({
				workflowId: "cross-repo-bugfix",
				configRoot,
				repoBindings: {},
			}),
		).rejects.toMatchObject({
			code: "invalid_run_launch_input",
			issues: [
				expect.objectContaining({
					code: "config_root_invalid",
					path: "$.configRoot",
				}),
			],
		});
	});

	test("ignores unrelated invalid workflow files when launching a valid workflow", async () => {
		const configRoot = await createTempConfigRoot();
		await Bun.write(join(configRoot, "workflows", "broken.json"), "{ invalid json\n");
		const agentConsolePath = await createTempDirectory("agent-console");
		const orchestratorPath = await createTempDirectory("inngest-runtime");

		const result = await resolveRunLaunchRequest({
			workflowId: "cross-repo-bugfix",
			configRoot,
			repoBindings: {
				"agent-console": agentConsolePath,
				"inngest-orchestrator": orchestratorPath,
			},
		});

		expect(result.workflow.workflowId).toBe("cross-repo-bugfix");
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
				required: true,
				status: "resolved",
				resolvedPath: orchestratorPath,
			},
		]);
	});

	test("ignores duplicate workflow ids that do not match the requested workflow", async () => {
		const configRoot = await createTempConfigRoot({
			workflows: {
				"cross-repo-bugfix": makeWorkflow(),
				"duplicate-a": makeWorkflow({
					workflowId: "duplicate-workflow",
					name: "Duplicate Workflow A",
				}),
				"duplicate-b": makeWorkflow({
					workflowId: "duplicate-workflow",
					name: "Duplicate Workflow B",
				}),
			},
		});
		const agentConsolePath = await createTempDirectory("agent-console");
		const orchestratorPath = await createTempDirectory("inngest-runtime");

		const result = await resolveRunLaunchRequest({
			workflowId: "cross-repo-bugfix",
			configRoot,
			repoBindings: {
				"agent-console": agentConsolePath,
				"inngest-orchestrator": orchestratorPath,
			},
		});

		expect(result.workflow.workflowId).toBe("cross-repo-bugfix");
	});

	test("surfaces invalid target workflow files with file-path details", async () => {
		const configRoot = await createTempConfigRoot({
			workflows: {},
		});
		const targetFilePath = join(configRoot, "workflows", "cross-repo-bugfix.json");
		await Bun.write(targetFilePath, "{ invalid json\n");

		await expect(
			resolveRunLaunchRequest({
				workflowId: "cross-repo-bugfix",
				configRoot,
				repoBindings: {},
			}),
		).rejects.toMatchObject({
			code: "invalid_run_launch_input",
			issues: [
				expect.objectContaining({
					code: "workflow_invalid",
					path: "$",
					filePath: targetFilePath,
				}),
			],
		});
	});

	test("classifies malformed target workflows correctly when configRoot is relative", async () => {
		const absoluteConfigRoot = await createTempConfigRoot({
			workflows: {},
		});
		const targetFilePath = join(
			absoluteConfigRoot,
			"workflows",
			"cross-repo-bugfix.json",
		);
		await Bun.write(targetFilePath, "{ invalid json\n");
		const configRoot = relative(process.cwd(), absoluteConfigRoot);

		await expect(
			resolveRunLaunchRequest({
				workflowId: "cross-repo-bugfix",
				configRoot,
				repoBindings: {},
			}),
		).rejects.toMatchObject({
			code: "invalid_run_launch_input",
			issues: [
				expect.objectContaining({
					code: "workflow_invalid",
					filePath: targetFilePath,
				}),
			],
		});
	});

	test("reports targeted invalid workflow files by declared workflow id", async () => {
		const configRoot = await createTempConfigRoot({
			workflows: {
				custom: {
					schemaVersion: 1,
					workflowId: "ship-feature",
				},
			},
		});

		await expect(
			resolveRunLaunchRequest({
				workflowId: "ship-feature",
				configRoot,
				repoBindings: {},
			}),
		).rejects.toMatchObject({
			code: "invalid_run_launch_input",
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "workflow_invalid",
					filePath: expect.stringContaining("/workflows/custom.json"),
				}),
			]),
		});
	});

	test("prefers a valid workflow over malformed decoy files with the same workflow id", async () => {
		const configRoot = await createTempConfigRoot({
			workflows: {
				custom: {
					schemaVersion: 1,
					workflowId: "ship-feature",
				},
				"ship-feature": makeWorkflow({
					workflowId: "ship-feature",
					name: "Ship Feature",
				}),
			},
		});
		const agentConsolePath = await createTempDirectory("agent-console");
		const orchestratorPath = await createTempDirectory("inngest-runtime");

		const result = await resolveRunLaunchRequest({
			workflowId: "ship-feature",
			configRoot,
			repoBindings: {
				"agent-console": agentConsolePath,
				"inngest-orchestrator": orchestratorPath,
			},
		});

		expect(result.workflow.workflowId).toBe("ship-feature");
		expect(result.workflow.filePath).toContain("/workflows/ship-feature.json");
	});

	test("rejects workflows that fail executable validation before repo resolution", async () => {
		const baseWorkflow = makeWorkflow();
		const configRoot = await createTempConfigRoot({
			workflows: {
				"cross-repo-bugfix": {
					...baseWorkflow,
					nodes: baseWorkflow.nodes.map((node) =>
						node.id === "implement"
							? {
									...node,
									settings: {
										...node.settings,
										template: "task.unstable",
									},
							  }
							: node,
					),
				},
			},
		});
		const agentConsolePath = await createTempDirectory("agent-console");
		const orchestratorPath = await createTempDirectory("inngest-runtime");

		await expect(
			resolveRunLaunchRequest({
				workflowId: "cross-repo-bugfix",
				configRoot,
				repoBindings: {
					"agent-console": agentConsolePath,
					"inngest-orchestrator": orchestratorPath,
				},
			}),
		).rejects.toMatchObject({
			code: "invalid_run_launch_input",
			issues: [
				expect.objectContaining({
					code: "workflow_not_executable",
					path: "$.nodes[1].settings.template",
					filePath: expect.stringContaining("/workflows/cross-repo-bugfix.json"),
				}),
			],
		});
	});

	test("ignores unrelated invalid workflow documents when the requested workflow is valid", async () => {
		const configRoot = await createTempConfigRoot({
			workflows: {
				"cross-repo-bugfix": makeWorkflow(),
				broken: {
					schemaVersion: 1,
					workflowId: "broken-workflow",
				},
			},
		});
		const agentConsolePath = await createTempDirectory("agent-console");
		const orchestratorPath = await createTempDirectory("inngest-runtime");

		const result = await resolveRunLaunchRequest({
			workflowId: "cross-repo-bugfix",
			configRoot,
			repoBindings: {
				"agent-console": agentConsolePath,
				"inngest-orchestrator": orchestratorPath,
			},
		});

		expect(result.workflow.workflowId).toBe("cross-repo-bugfix");
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

	test("supports repo ids that would collide with Object prototype keys", async () => {
		const configRoot = await createTempConfigRoot({
			repositoryCatalog: {
				schemaVersion: 1,
				repositories: [{ id: "__proto__", label: "Prototype Repo" }],
			},
			workflows: {
				"proto-workflow": makeWorkflow({
					workflowId: "proto-workflow",
					repositories: [{ id: "__proto__", required: true }],
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
							target: { repoId: "__proto__" },
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
							target: { repoId: "__proto__" },
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
				}),
			},
		});
		const protoPath = await createTempDirectory("proto-repo");

		const request = JSON.parse(`{
			"workflowId": "proto-workflow",
			"configRoot": ${JSON.stringify(configRoot)},
			"repoBindings": {
				"__proto__": ${JSON.stringify(protoPath)}
			}
		}`);

		const result = await resolveRunLaunchRequest(request);

		expect(result.repoBindings).toEqual([
			{
				repoId: "__proto__",
				label: "Prototype Repo",
				required: true,
				status: "resolved",
				resolvedPath: protoPath,
			},
		]);
	});
});

async function createTempConfigRoot(input?: {
	repositoryCatalog?: {
		schemaVersion: 1;
		repositories: { id: string; label: string }[];
	};
	workflows?: Record<string, unknown>;
}) {
	const root = await createTempDirectory("inngest-orchestrator-runs-");
	const reposDirectory = join(root, "repos");
	const workflowsDirectory = join(root, "workflows");
	await mkdir(reposDirectory, { recursive: true });
	await mkdir(workflowsDirectory, { recursive: true });

	await Bun.write(
		join(reposDirectory, "workspace.repos.json"),
		serializeWorkflowRepositoryCatalog(
			input?.repositoryCatalog ?? makeRepositoryCatalog(),
		),
	);

	for (const [fileName, workflow] of Object.entries(input?.workflows ?? {})) {
		await Bun.write(
			join(
				workflowsDirectory,
				fileName.endsWith(".json") ? fileName : `${fileName}.json`,
			),
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
