import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, posix, relative, resolve } from "node:path";
import type {
	RuntimeShellCheckArtifactFile,
	RuntimeShellCheckArtifactMetadata,
	RuntimeShellCheckArtifactReference,
	RuntimeShellOutputPreview,
} from "./types.ts";

const ARTIFACT_ROOT_DIRECTORY = ".inngest-orchestrator";
const SHELL_CHECK_ARTIFACT_KIND = "shell-check-report";
const PREVIEW_BYTE_LIMIT = 2048;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function createShellCheckArtifactRelativePath(input: {
	runId: string;
	stepId: string;
}) {
	return posix.join(
		ARTIFACT_ROOT_DIRECTORY,
		"artifacts",
		"runs",
		encodeArtifactPathSegment(input.runId),
		"steps",
		encodeArtifactPathSegment(input.stepId),
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
	const repoRoot = resolve(input.repoPath);
	const absolutePath = resolve(repoRoot, relativePath);
	assertArtifactPathInsideRepo({
		repoRoot,
		absolutePath,
		runId: input.runId,
		stepId: input.stepId,
	});
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

function encodeArtifactPathSegment(value: string) {
	const bytes = textEncoder.encode(value);
	let encoded = "";

	for (const byte of bytes) {
		if (isSafeArtifactPathByte(byte)) {
			encoded += String.fromCharCode(byte);
			continue;
		}

		encoded += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
	}

	return encoded;
}

function isSafeArtifactPathByte(byte: number) {
	return (
		(byte >= 48 && byte <= 57) ||
		(byte >= 65 && byte <= 90) ||
		(byte >= 97 && byte <= 122) ||
		byte === 45 ||
		byte === 95
	);
}

function assertArtifactPathInsideRepo(input: {
	repoRoot: string;
	absolutePath: string;
	runId: string;
	stepId: string;
}) {
	const artifactPathRelativeToRepo = relative(
		input.repoRoot,
		input.absolutePath,
	);
	if (
		artifactPathRelativeToRepo === "" ||
		artifactPathRelativeToRepo.startsWith("..") ||
		isAbsolute(artifactPathRelativeToRepo)
	) {
		throw new Error(
			`Shell-check artifact path escaped the repo root for run "${input.runId}" step "${input.stepId}".`,
		);
	}
}
