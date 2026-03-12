import { mkdir } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import type {
	RuntimeShellCheckArtifactFile,
	RuntimeShellCheckArtifactMetadata,
	RuntimeShellCheckArtifactReference,
	RuntimeShellOutputPreview,
} from "./types.ts";

const ARTIFACT_ROOT_DIRECTORY = ".inngest-orchestrator";
const SHELL_CHECK_ARTIFACT_KIND = "shell-check-report";
const PREVIEW_BYTE_LIMIT = 2048;

const textDecoder = new TextDecoder();

export function createShellCheckArtifactRelativePath(input: {
	runId: string;
	stepId: string;
}) {
	return posix.join(
		ARTIFACT_ROOT_DIRECTORY,
		"artifacts",
		"runs",
		input.runId,
		"steps",
		input.stepId,
		"shell-check.json",
	);
}

export function createShellOutputPreview(
	bytes: Uint8Array,
): RuntimeShellOutputPreview {
	const previewBytes = bytes.slice(0, PREVIEW_BYTE_LIMIT);
	return {
		preview: textDecoder.decode(previewBytes),
		byteLength: bytes.byteLength,
		truncated: bytes.byteLength > PREVIEW_BYTE_LIMIT,
	};
}

export async function writeShellCheckArtifact(input: {
	runId: string;
	stepId: string;
	repoId: string;
	repoPath: string;
	command: string;
	exitCode: number;
	status: "completed" | "failed";
	stdoutBytes: Uint8Array;
	stderrBytes: Uint8Array;
}) {
	const relativePath = createShellCheckArtifactRelativePath({
		runId: input.runId,
		stepId: input.stepId,
	});
	const absolutePath = join(input.repoPath, relativePath);
	const artifactFile: RuntimeShellCheckArtifactFile = {
		schemaVersion: 1,
		runId: input.runId,
		stepId: input.stepId,
		repoId: input.repoId,
		command: input.command,
		exitCode: input.exitCode,
		status: input.status,
		stdout: {
			text: textDecoder.decode(input.stdoutBytes),
			byteLength: input.stdoutBytes.byteLength,
		},
		stderr: {
			text: textDecoder.decode(input.stderrBytes),
			byteLength: input.stderrBytes.byteLength,
		},
	};
	await mkdir(dirname(absolutePath), { recursive: true });
	await Bun.write(absolutePath, `${JSON.stringify(artifactFile, null, 2)}\n`);

	const metadata: RuntimeShellCheckArtifactMetadata = {
		schemaVersion: 1,
		command: input.command,
		exitCode: input.exitCode,
		stdout: createShellOutputPreview(input.stdoutBytes),
		stderr: createShellOutputPreview(input.stderrBytes),
	};

	const artifact: RuntimeShellCheckArtifactReference = {
		kind: SHELL_CHECK_ARTIFACT_KIND,
		repoId: input.repoId,
		relativePath,
		metadata,
	};

	return {
		artifact,
		artifactFile,
		absolutePath,
	};
}

export function toByteArray(value: ArrayBuffer) {
	return new Uint8Array(value);
}
