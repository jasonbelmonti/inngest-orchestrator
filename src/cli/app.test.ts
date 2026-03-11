import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCli } from "./app.ts";
import { serializeWorkflowRepositoryCatalog } from "../workflows/serialization.ts";
import {
	makeRepositoryCatalog,
	makeWorkflow,
} from "../workflows/test-fixtures.ts";

const tempConfigRoots: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempConfigRoots.map((directory) =>
			rm(directory, { recursive: true, force: true }),
		),
	);
	tempConfigRoots.length = 0;
});

describe("workflow CLI", () => {
	test("lists workflows as machine-consumable JSON", async () => {
		const configRoot = await createTempConfigRoot({
			workflows: {
				"cross-repo-bugfix": makeWorkflow(),
			},
		});

		const result = await runCli([
			"workflow",
			"list",
			"--config-root",
			configRoot,
		]);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(JSON.parse(result.stdout)).toMatchObject({
			ok: true,
			command: "workflow.list",
			workflows: [expect.objectContaining({ workflowId: "cross-repo-bugfix" })],
		});
	});

	test("reads workflows as machine-consumable JSON", async () => {
		const configRoot = await createTempConfigRoot({
			workflows: {
				"cross-repo-bugfix": makeWorkflow(),
			},
		});

		const result = await runCli([
			"workflow",
			"read",
			"cross-repo-bugfix",
			"--config-root",
			configRoot,
		]);

		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({
			ok: true,
			command: "workflow.read",
			workflow: expect.objectContaining({
				workflowId: "cross-repo-bugfix",
				contentHash: expect.any(String),
			}),
		});
	});

	test("validates stdin envelopes and returns compiled workflow data", async () => {
		const configRoot = await createTempConfigRoot();

		const result = await runCli(
			["workflow", "validate", "--config-root", configRoot],
			{
				stdinText: JSON.stringify({ document: makeWorkflow() }),
			},
		);

		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({
			ok: true,
			command: "workflow.validate",
			validation: expect.objectContaining({
				contentHash: expect.any(String),
				compiled: expect.objectContaining({ workflowId: "cross-repo-bugfix" }),
			}),
		});
	});

	test("rejects optimistic saves that omit a baseline hash for existing workflows", async () => {
		const configRoot = await createTempConfigRoot({
			workflows: {
				"cross-repo-bugfix": makeWorkflow(),
			},
		});

		const result = await runCli(
			["workflow", "save", "--config-root", configRoot],
			{
				stdinText: JSON.stringify({
					document: makeWorkflow({
						name: "Updated Name",
					}),
				}),
			},
		);

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toBe("");
		expect(JSON.parse(result.stderr)).toMatchObject({
			ok: false,
			command: "workflow.save",
			error: expect.objectContaining({ code: "workflow_save_conflict" }),
		});
	});

	test("rejects non-string save file paths instead of falling back to the default target", async () => {
		const configRoot = await createTempConfigRoot();

		const result = await runCli(
			["workflow", "save", "--config-root", configRoot],
			{
				stdinText: JSON.stringify({
					document: makeWorkflow({
						workflowId: "ship-feature",
						name: "Ship Feature",
					}),
					filePath: 123,
				}),
			},
		);

		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stderr)).toMatchObject({
			ok: false,
			command: "workflow.save",
			error: expect.objectContaining({ code: "invalid_cli_input" }),
		});
		expect(
			await Bun.file(
				join(configRoot, "workflows", "ship-feature.json"),
			).exists(),
		).toBe(false);
	});

	test("rejects invalid root commands with a CLI argument error", async () => {
		const result = await runCli(["nonsense"]);

		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stderr)).toMatchObject({
			ok: false,
			error: expect.objectContaining({ code: "invalid_cli_arguments" }),
		});
	});

	test("rejects invalid workflow subcommands before config-root resolution", async () => {
		const result = await runCli(["workflow", "nonsense"]);

		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stderr)).toMatchObject({
			ok: false,
			error: expect.objectContaining({ code: "invalid_cli_arguments" }),
		});
	});

	test("rejects workflow read calls that omit the workflow id before config-root resolution", async () => {
		const result = await runCli(["workflow", "read"]);

		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stderr)).toMatchObject({
			ok: false,
			command: "workflow.read",
			error: expect.objectContaining({ code: "invalid_cli_arguments" }),
		});
	});

	test("rejects extra positional arguments before config-root resolution", async () => {
		const result = await runCli(["workflow", "list", "extra"]);

		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stderr)).toMatchObject({
			ok: false,
			command: "workflow.list",
			error: expect.objectContaining({ code: "invalid_cli_arguments" }),
		});
	});

	test("rejects missing stdin when workflow save is otherwise valid", async () => {
		const configRoot = await createTempConfigRoot();
		const result = await runCli([
			"workflow",
			"save",
			"--config-root",
			configRoot,
		]);

		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stderr)).toMatchObject({
			ok: false,
			command: "workflow.save",
			error: expect.objectContaining({ code: "invalid_cli_input" }),
		});
	});

	test("does not read stdin for invalid workflow flags", async () => {
		let readAttempts = 0;

		const result = await runCli(["workflow", "save", "--bogus"], {
			readStdinText: async () => {
				readAttempts += 1;
				return JSON.stringify({ document: makeWorkflow() });
			},
		});

		expect(readAttempts).toBe(0);
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stderr)).toMatchObject({
			ok: false,
			error: expect.objectContaining({ code: "invalid_cli_arguments" }),
		});
	});

	test("rejects flag-like values for --config-root before reading stdin", async () => {
		let readAttempts = 0;

		const result = await runCli(
			["workflow", "save", "--config-root", "--bogus"],
			{
				readStdinText: async () => {
					readAttempts += 1;
					return JSON.stringify({ document: makeWorkflow() });
				},
			},
		);

		expect(readAttempts).toBe(0);
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stderr)).toMatchObject({
			ok: false,
			error: expect.objectContaining({ code: "invalid_cli_arguments" }),
		});
	});

	test("does not read stdin from a TTY for workflow save", async () => {
		let readAttempts = 0;
		const configRoot = await createTempConfigRoot();

		const result = await runCli(
			["workflow", "save", "--config-root", configRoot],
			{
				stdinIsTTY: true,
				readStdinText: async () => {
					readAttempts += 1;
					return JSON.stringify({ document: makeWorkflow() });
				},
			},
		);

		expect(readAttempts).toBe(0);
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stderr)).toMatchObject({
			ok: false,
			command: "workflow.save",
			error: expect.objectContaining({ code: "invalid_cli_input" }),
		});
	});
});

async function createTempConfigRoot(input?: {
	workflows?: Record<string, unknown>;
}) {
	const root = await mkdtemp(join(tmpdir(), "inngest-orchestrator-cli-"));
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
