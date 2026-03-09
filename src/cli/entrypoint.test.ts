import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

describe("CLI entrypoint", () => {
	test("emits pure JSON errors when invoked directly with bun", async () => {
		const cliPath = fileURLToPath(new URL("../cli.ts", import.meta.url));
		const process = Bun.spawn({
			cmd: ["bun", cliPath, "workflow", "nonsense"],
			stdout: "pipe",
			stderr: "pipe",
		});

		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(process.stdout).text(),
			new Response(process.stderr).text(),
			process.exited,
		]);

		expect(exitCode).toBe(1);
		expect(stdout).toBe("");
		expect(() => JSON.parse(stderr)).not.toThrow();
		expect(JSON.parse(stderr)).toMatchObject({
			ok: false,
			error: expect.objectContaining({ code: "invalid_cli_arguments" }),
		});
	});

	test("emits pure JSON successes when invoked directly with bun", async () => {
		const cliPath = fileURLToPath(new URL("../cli.ts", import.meta.url));
		const tempRoot = await mkdtemp(join(tmpdir(), "workflow-cli-entrypoint-"));
		await mkdir(join(tempRoot, "repos"), { recursive: true });
		await mkdir(join(tempRoot, "workflows"), { recursive: true });
		await Bun.write(
			join(tempRoot, "repos", "workspace.repos.json"),
			JSON.stringify(
				{
					schemaVersion: 1,
					repositories: [
						{
							id: "agent-console",
							label: "Agent Console",
						},
					],
				},
				null,
				2,
			),
		);

		const process = Bun.spawn({
			cmd: ["bun", cliPath, "workflow", "list", "--config-root", tempRoot],
			stdout: "pipe",
			stderr: "pipe",
		});

		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(process.stdout).text(),
			new Response(process.stderr).text(),
			process.exited,
		]);

		expect(exitCode).toBe(0);
		expect(stderr).toBe("");
		expect(() => JSON.parse(stdout)).not.toThrow();
		expect(JSON.parse(stdout)).toMatchObject({
			ok: true,
			command: "workflow.list",
			configRoot: tempRoot,
			workflows: [],
		});
	});
});
