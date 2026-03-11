#!/usr/bin/env bun

const CONFIG_ROOT = "./examples/config-root";
const MISSING_CONFIG_ROOT = "./examples/config-root-does-not-exist";

type CliRunResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

type CliSuccessResponse = {
	ok: boolean;
	[key: string]: unknown;
};

function runCliCommand(args: string[], stdinText?: string): CliRunResult {
	const proc = Bun.spawnSync({
		cmd: ["bun", "./src/cli.ts", ...args],
		stdin: stdinText === undefined ? undefined : new TextEncoder().encode(stdinText),
		stdout: "pipe",
		stderr: "pipe",
	});

	return {
		exitCode: proc.exitCode,
		stdout: proc.stdout ? new TextDecoder().decode(proc.stdout) : "",
		stderr: proc.stderr ? new TextDecoder().decode(proc.stderr) : "",
	};
}

function parseCliOutput(raw: string, command: string) {
	const text = raw.trim();
	if (!text.length) {
		throw new Error(`${command}: expected JSON output, got empty response`);
	}
	try {
		return JSON.parse(text) as CliSuccessResponse;
	} catch (error) {
		throw new Error(`${command}: expected JSON output, failed to parse`);
	}
}

function assert(condition: unknown, message: string) {
	if (!condition) {
		throw new Error(message);
	}
}

function main() {
	const list = runCliCommand(["workflow", "list", "--config-root", CONFIG_ROOT]);
	assert(list.exitCode === 0, "workflow list should exit successfully");
	const listPayload = parseCliOutput(list.stdout, "workflow list");
	assert(
		listPayload.ok === true &&
			Array.isArray((listPayload as { workflows?: unknown[] }).workflows),
		"workflow list should return ok=true and workflow array",
	);

	const read = runCliCommand([
		"workflow",
		"read",
		"cross-repo-bugfix",
		"--config-root",
		CONFIG_ROOT,
	]);
	assert(read.exitCode === 0, "workflow read should exit successfully");
	const readPayload = parseCliOutput(read.stdout, "workflow read");
	const workflow = (readPayload as { workflow?: Record<string, unknown> }).workflow;
	const workflowDocument = workflow?.document;
	assert(
		readPayload.ok === true &&
			typeof workflow === "object" &&
			workflow !== null &&
			typeof (workflow as { workflowId?: string }).workflowId === "string" &&
			typeof (workflow as { contentHash?: string }).contentHash === "string",
		"workflow read should include workflow record with workflowId and contentHash",
	);
	assert(
		workflowDocument !== undefined,
		"workflow read should return a document field",
	);

	const validate = runCliCommand(
		["workflow", "validate", "--config-root", CONFIG_ROOT],
		JSON.stringify({ document: workflowDocument }),
	);
	assert(
		validate.exitCode === 0,
		`workflow validate should exit successfully for known good payload: ${JSON.stringify({
			exitCode: validate.exitCode,
			stderr: validate.stderr.trim() || "<empty>",
		})}`,
	);
	const validatePayload = parseCliOutput(validate.stdout, "workflow validate");
	assert(
		validatePayload.ok === true &&
			typeof (validatePayload as { validation?: unknown }).validation !== "undefined",
		"workflow validate should return validation output",
	);

	const save = runCliCommand(
		["workflow", "save", "--config-root", CONFIG_ROOT],
		JSON.stringify({
			document: workflow?.document,
			expectedContentHash: workflow?.contentHash,
			filePath: workflow?.filePath,
		}),
	);
	assert(save.exitCode === 0, "workflow save should accept existing file update payload");
	const savePayload = parseCliOutput(save.stdout, "workflow save");
	assert(
		savePayload.ok === true &&
			typeof (savePayload as { save?: unknown }).save !== "undefined",
		"workflow save should include save result",
	);

	const invalidValidate = runCliCommand(
		["workflow", "validate", "--config-root", CONFIG_ROOT],
		"{",
	);
	assert(
		invalidValidate.exitCode !== 0,
		"workflow validate should fail for invalid JSON envelope",
	);
	const invalidValidatePayload = parseCliOutput(invalidValidate.stderr, "workflow validate failure");
	assert(
		invalidValidatePayload.ok === false &&
			typeof (invalidValidatePayload as { error?: { code?: string } }).error?.code ===
				"string",
		"workflow validate failure should return structured error response",
	);

	const invalidSave = runCliCommand(
		["workflow", "save", "--config-root", CONFIG_ROOT],
		JSON.stringify({}),
	);
	assert(invalidSave.exitCode !== 0, "workflow save should fail for malformed payload");
	const invalidSavePayload = parseCliOutput(invalidSave.stderr, "workflow save failure");
	assert(
		invalidSavePayload.ok === false &&
			typeof (invalidSavePayload as { error?: { code?: string } }).error?.code ===
				"string",
		"workflow save failure should return structured error response",
	);

	const missingConfig = runCliCommand([
		"workflow",
		"list",
		"--config-root",
		MISSING_CONFIG_ROOT,
	]);
	assert(
		missingConfig.exitCode !== 0,
		"workflow list should fail for missing config root",
	);
	const missingConfigPayload = parseCliOutput(missingConfig.stderr, "workflow list missing-config");
	assert(
		missingConfigPayload.ok === false &&
			typeof (missingConfigPayload as { error?: { code?: string } }).error?.code ===
				"string",
		"missing config root should return structured error response",
	);
}

main();
