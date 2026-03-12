import type {
	RuntimeExecutionPlanStep,
	RuntimeShellCheckResult,
} from "./types.ts";
import { toByteArray, writeShellCheckArtifact } from "./shell-artifacts.ts";

export async function executeShellCheck(input: {
	runId: string;
	step: Extract<RuntimeExecutionPlanStep, { kind: "check" }>;
}): Promise<RuntimeShellCheckResult> {
	const process = Bun.spawn(["/bin/sh", "-lc", input.step.command], {
		cwd: input.step.target.resolvedPath,
		stdout: "pipe",
		stderr: "pipe",
	});

	const [stdoutBuffer, stderrBuffer, exitCode] = await Promise.all([
		readBuffer(process.stdout),
		readBuffer(process.stderr),
		process.exited,
	]);
	const status = exitCode === 0 ? "completed" : "failed";
	const { artifact } = await writeShellCheckArtifact({
		runId: input.runId,
		stepId: input.step.id,
		repoId: input.step.target.repoId,
		repoPath: input.step.target.resolvedPath,
		command: input.step.command,
		exitCode,
		status,
		stdoutBytes: stdoutBuffer,
		stderrBytes: stderrBuffer,
	});

	return {
		stepId: input.step.id,
		repoId: input.step.target.repoId,
		command: input.step.command,
		exitCode,
		status,
		artifact,
	};
}

async function readBuffer(
	stream: ReadableStream<Uint8Array> | null,
): Promise<Uint8Array> {
	if (!stream) {
		return new Uint8Array();
	}

	return toByteArray(await new Response(stream).arrayBuffer());
}
