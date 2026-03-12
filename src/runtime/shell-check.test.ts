import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeShellCheck } from "./shell-check.ts";
import type { RuntimeExecutionPlanStep } from "./types.ts";

const createdRoots: string[] = [];

describe("executeShellCheck", () => {
	afterEach(async () => {
		await Promise.all(
			createdRoots.map(async (root) => {
				await Bun.$`rm -rf ${root}`.quiet();
			}),
		);
		createdRoots.length = 0;
	});

	test("executes the command in the resolved repo target and writes a deterministic artifact", async () => {
		const repoPath = await createRepoRoot();
		await Bun.write(join(repoPath, "marker.txt"), "repo-marker\n");

		const result = await executeShellCheck({
			runId: "run-001",
			step: makeShellCheckStep({
				command: "cat marker.txt",
				resolvedPath: repoPath,
			}),
		});

		expect(result).toEqual({
			stepId: "typecheck",
			repoId: "agent-console",
			command: "cat marker.txt",
			exitCode: 0,
			status: "completed",
			artifact: {
				kind: "shell-check-report",
				repoId: "agent-console",
				relativePath:
					".inngest-orchestrator/artifacts/runs/run-001/steps/typecheck/shell-check.json",
				metadata: {
					schemaVersion: 1,
					command: "cat marker.txt",
					exitCode: 0,
					stdout: {
						preview: "repo-marker\n",
						byteLength: Buffer.byteLength("repo-marker\n"),
						truncated: false,
					},
					stderr: {
						preview: "",
						byteLength: 0,
						truncated: false,
					},
				},
			},
		});

		const artifactFile = await Bun.file(
			join(repoPath, result.artifact.relativePath),
		).json();
		expect(artifactFile).toEqual({
			schemaVersion: 1,
			runId: "run-001",
			stepId: "typecheck",
			repoId: "agent-console",
			command: "cat marker.txt",
			exitCode: 0,
			status: "completed",
			stdout: {
				text: "repo-marker\n",
				byteLength: Buffer.byteLength("repo-marker\n"),
			},
			stderr: {
				text: "",
				byteLength: 0,
			},
		});
	});

	test("returns a failed result with artifact previews for non-zero exits", async () => {
		const repoPath = await createRepoRoot();

		const result = await executeShellCheck({
			runId: "run-002",
			step: makeShellCheckStep({
				command: "printf 'stdout-line\\n'; printf 'stderr-line\\n' >&2; exit 7",
				resolvedPath: repoPath,
				stepId: "verify",
			}),
		});

		expect(result).toEqual({
			stepId: "verify",
			repoId: "agent-console",
			command: "printf 'stdout-line\\n'; printf 'stderr-line\\n' >&2; exit 7",
			exitCode: 7,
			status: "failed",
			artifact: {
				kind: "shell-check-report",
				repoId: "agent-console",
				relativePath:
					".inngest-orchestrator/artifacts/runs/run-002/steps/verify/shell-check.json",
				metadata: {
					schemaVersion: 1,
					command:
						"printf 'stdout-line\\n'; printf 'stderr-line\\n' >&2; exit 7",
					exitCode: 7,
					stdout: {
						preview: "stdout-line\n",
						byteLength: Buffer.byteLength("stdout-line\n"),
						truncated: false,
					},
					stderr: {
						preview: "stderr-line\n",
						byteLength: Buffer.byteLength("stderr-line\n"),
						truncated: false,
					},
				},
			},
		});

		const artifactFile = await Bun.file(
			join(repoPath, result.artifact.relativePath),
		).json();
		expect(artifactFile).toEqual({
			schemaVersion: 1,
			runId: "run-002",
			stepId: "verify",
			repoId: "agent-console",
			command: "printf 'stdout-line\\n'; printf 'stderr-line\\n' >&2; exit 7",
			exitCode: 7,
			status: "failed",
			stdout: {
				text: "stdout-line\n",
				byteLength: Buffer.byteLength("stdout-line\n"),
			},
			stderr: {
				text: "stderr-line\n",
				byteLength: Buffer.byteLength("stderr-line\n"),
			},
		});
	});
});

async function createRepoRoot() {
	const root = await mkdtemp(join(tmpdir(), "runtime-shell-check-"));
	const repoPath = join(root, "repo-target");
	await mkdir(repoPath, { recursive: true });
	createdRoots.push(root);
	return repoPath;
}

function makeShellCheckStep(input: {
	command: string;
	resolvedPath: string;
	stepId?: string;
}): Extract<RuntimeExecutionPlanStep, { kind: "check" }> {
	return {
		id: input.stepId ?? "typecheck",
		kind: "check",
		template: "check.shell",
		label: "Typecheck",
		target: {
			repoId: "agent-console",
			resolvedPath: input.resolvedPath,
			worktreeStrategy: "shared",
		},
		command: input.command,
	};
}
