import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

describe("CLI entrypoint", () => {
	test("does not wait for stdin when workflow flags are invalid", async () => {
		const cliPath = fileURLToPath(new URL("../cli.ts", import.meta.url));
		const process = Bun.spawn({
			cmd: ["bun", cliPath, "workflow", "save", "--bogus"],
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		});

		const exit = await Promise.race([
			process.exited.then((exitCode) => ({
				timedOut: false as const,
				exitCode,
			})),
			Bun.sleep(250).then(() => ({ timedOut: true as const, exitCode: -1 })),
		]);

		if (exit.timedOut) {
			process.kill();
		}

		const stderr = await new Response(process.stderr).text();

		expect(exit.timedOut).toBe(false);
		expect(exit.exitCode).toBe(1);
		expect(() => JSON.parse(stderr)).not.toThrow();
	});

	test("does not wait for stdin when --config-root is followed by another flag", async () => {
		const cliPath = fileURLToPath(new URL("../cli.ts", import.meta.url));
		const process = Bun.spawn({
			cmd: ["bun", cliPath, "workflow", "save", "--config-root", "--bogus"],
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		});

		const exit = await Promise.race([
			process.exited.then((exitCode) => ({
				timedOut: false as const,
				exitCode,
			})),
			Bun.sleep(250).then(() => ({ timedOut: true as const, exitCode: -1 })),
		]);

		if (exit.timedOut) {
			process.kill();
		}

		const stderr = await new Response(process.stderr).text();

		expect(exit.timedOut).toBe(false);
		expect(exit.exitCode).toBe(1);
		expect(() => JSON.parse(stderr)).not.toThrow();
		expect(JSON.parse(stderr)).toMatchObject({
			ok: false,
			error: expect.objectContaining({ code: "invalid_cli_arguments" }),
		});
	});

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
