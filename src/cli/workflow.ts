import { CliError } from "./errors.ts";
import type { WorkflowCliCommand, WorkflowCliResponse } from "./types.ts";
import {
	saveWorkflowDocument,
	validateWorkflowDocumentInput,
} from "../workflows/authoring.ts";
import { WorkflowError } from "../workflows/errors.ts";
import { WorkflowStore } from "../workflows/store.ts";

interface ExecuteWorkflowCommandInput {
	args: string[];
	stdinText?: string;
}

interface WorkflowSaveEnvelope {
	document: unknown;
	expectedContentHash?: string | null;
	filePath?: string | null;
}

interface WorkflowValidateEnvelope {
	document: unknown;
}

export async function executeWorkflowCommand(
	input: ExecuteWorkflowCommandInput,
): Promise<WorkflowCliResponse> {
	return executePreparedWorkflowCommand(
		prepareWorkflowCommandArgs(input.args),
		input.stdinText,
	);
}

export async function executePreparedWorkflowCommand(
	preparation: PreparedWorkflowCommand,
	stdinText: string | undefined,
): Promise<WorkflowCliResponse> {
	const store = await WorkflowStore.open({ configRoot: preparation.configRoot });

	switch (preparation.subcommand) {
		case "list":
			return {
				ok: true,
				command: "workflow.list",
				configRoot: store.configRoot,
				workflows: await store.listWorkflows(),
			};
		case "read": {
			return {
				ok: true,
				command: "workflow.read",
				configRoot: store.configRoot,
				workflow: await store.readWorkflow(preparation.workflowId),
			};
		}
		case "validate": {
			const envelope = parseJsonEnvelope<WorkflowValidateEnvelope>(
				stdinText,
				"workflow.validate",
			);
			if (!hasDocument(envelope)) {
				throw new CliError({
					code: "invalid_cli_input",
					command: "workflow.validate",
					message: "workflow validate expects a JSON object with a document field on stdin.",
				});
			}
			const validation = await validateWorkflowDocumentInput({
				store,
				document: envelope.document,
			});
			return {
				ok: true,
				command: "workflow.validate",
				configRoot: store.configRoot,
				validation: {
					contentHash: validation.contentHash,
					compiled: validation.compiled,
					document: validation.document,
					filePath: validation.filePath,
				},
			};
		}
		case "save": {
			const envelope = parseJsonEnvelope<WorkflowSaveEnvelope>(
				stdinText,
				"workflow.save",
			);
			if (!hasDocument(envelope)) {
				throw new CliError({
					code: "invalid_cli_input",
					command: "workflow.save",
					message: "workflow save expects a JSON object with a document field on stdin.",
				});
				}
				const save = await saveWorkflowDocument({
					store,
					options: {
						document: envelope.document,
						expectedContentHash: envelope.expectedContentHash ?? null,
						filePath: parseOptionalStringInput(
							envelope.filePath,
							"filePath",
							"workflow.save",
						),
					},
				});
			return {
				ok: true,
				command: "workflow.save",
				configRoot: store.configRoot,
				save: {
					operation: save.operation,
					compiled: save.compiled,
					workflow: save.workflow,
				},
				};
			}
	}
}

type PreparedWorkflowCommand =
	| {
			subcommand: "list";
			command: "workflow.list";
			configRoot?: string;
			requiresStdin: false;
	  }
	| {
			subcommand: "read";
			command: "workflow.read";
			configRoot?: string;
			requiresStdin: false;
			workflowId: string;
	  }
	| {
			subcommand: "validate";
			command: "workflow.validate";
			configRoot?: string;
			requiresStdin: true;
	  }
	| {
			subcommand: "save";
			command: "workflow.save";
			configRoot?: string;
			requiresStdin: true;
	  };

export function prepareWorkflowCommandArgs(args: string[]): PreparedWorkflowCommand {
	const [subcommand, ...rawArgs] = args;
	assertKnownWorkflowSubcommand(subcommand);
	const { configRoot, positional } = parseWorkflowOptions(rawArgs);
	return prepareWorkflowCommand({
		subcommand,
		configRoot,
		positional,
	});
}

export function toWorkflowCliErrorResponse(
	error: unknown,
	command?: WorkflowCliCommand,
): WorkflowCliResponse {
	if (error instanceof WorkflowError) {
		return {
			ok: false,
			...(command ? { command } : {}),
			error: {
				code: error.code,
				message: error.message,
				...(error.filePath ? { filePath: error.filePath } : {}),
				...(error.issues ? { issues: error.issues } : {}),
			},
		};
	}

	if (error instanceof CliError) {
		return {
			ok: false,
			...(error.command ? { command: error.command as WorkflowCliCommand } : {}),
			error: {
				code: error.code,
				message: error.message,
			},
		};
	}

	return {
		ok: false,
		error: {
			code: "invalid_cli_input",
			message: error instanceof Error ? error.message : "Unknown CLI error.",
		},
	};
}

function prepareWorkflowCommand(input: {
	subcommand: "list" | "read" | "validate" | "save";
	configRoot?: string;
	positional: string[];
}): PreparedWorkflowCommand {
	switch (input.subcommand) {
		case "list":
			assertNoPositionalArgs(input.positional, "workflow.list");
			return {
				subcommand: "list",
				command: "workflow.list",
				configRoot: input.configRoot,
				requiresStdin: false,
			};
		case "read":
			if (input.positional.length !== 1) {
				throw new CliError({
					code: "invalid_cli_arguments",
					command: "workflow.read",
					message: "workflow read requires exactly one workflow id argument.",
				});
			}
			const [workflowId] = input.positional;
			if (!workflowId) {
				throw new CliError({
					code: "invalid_cli_arguments",
					command: "workflow.read",
					message: "workflow read requires exactly one workflow id argument.",
				});
			}
			return {
				subcommand: "read",
				command: "workflow.read",
				configRoot: input.configRoot,
				requiresStdin: false,
				workflowId,
			};
		case "validate":
			assertNoPositionalArgs(input.positional, "workflow.validate");
			return {
				subcommand: "validate",
				command: "workflow.validate",
				configRoot: input.configRoot,
				requiresStdin: true,
			};
		case "save":
			assertNoPositionalArgs(input.positional, "workflow.save");
			return {
				subcommand: "save",
				command: "workflow.save",
				configRoot: input.configRoot,
				requiresStdin: true,
			};
	}
}

function parseWorkflowOptions(args: string[]) {
	let configRoot: string | undefined;
	const positional: string[] = [];

	for (let index = 0; index < args.length; index += 1) {
		const value = args[index];
		if (value === undefined) {
			throw new CliError({
				code: "invalid_cli_arguments",
				message: "Invalid CLI argument list.",
			});
		}

		if (value === "--config-root") {
			const nextValue = args[index + 1];
			if (nextValue === undefined || nextValue.startsWith("-")) {
				throw new CliError({
					code: "invalid_cli_arguments",
					message: "--config-root requires a path value.",
				});
			}
			configRoot = nextValue;
			index += 1;
			continue;
		}

		if (value.startsWith("-")) {
			throw new CliError({
				code: "invalid_cli_arguments",
				message: `Unknown flag "${value}".`,
			});
		}

		positional.push(value);
	}

	return { configRoot, positional };
}

function parseJsonEnvelope<T>(stdinText: string | undefined, command: WorkflowCliCommand): T {
	if (!stdinText || stdinText.trim().length === 0) {
		throw new CliError({
			code: "invalid_cli_input",
			command,
			message: `${command} requires JSON input on stdin.`,
		});
	}

	try {
		return JSON.parse(stdinText) as T;
	} catch {
		throw new CliError({
			code: "invalid_cli_input",
			command,
			message: `${command} received invalid JSON on stdin.`,
		});
	}
}

function hasDocument(value: unknown): value is { document: unknown } {
	return value !== null && typeof value === "object" && "document" in value;
}

function parseOptionalStringInput(
	value: unknown,
	fieldName: string,
	command: WorkflowCliCommand,
) {
	if (value === undefined || value === null) {
		return null;
	}

	if (typeof value === "string") {
		return value;
	}

	throw new CliError({
		code: "invalid_cli_input",
		command,
		message: `${command} expects ${fieldName} to be a string or null when provided.`,
	});
}

function assertNoPositionalArgs(positional: string[], command: WorkflowCliCommand) {
	if (positional.length === 0) {
		return;
	}
	throw new CliError({
		code: "invalid_cli_arguments",
		command,
		message: `${command} does not accept positional arguments.`,
	});
}

function assertKnownWorkflowSubcommand(
	subcommand: string | undefined,
): asserts subcommand is "list" | "read" | "validate" | "save" {
	if (
		subcommand === "list" ||
		subcommand === "read" ||
		subcommand === "validate" ||
		subcommand === "save"
	) {
		return;
	}

	throw new CliError({
		code: "invalid_cli_arguments",
		message:
			"Expected one of: workflow list, workflow read <id>, workflow validate, workflow save.",
	});
}
