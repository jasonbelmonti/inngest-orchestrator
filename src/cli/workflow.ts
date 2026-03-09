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
	const [subcommand, ...rawArgs] = input.args;
	assertKnownWorkflowSubcommand(subcommand);
	const { configRoot, positional } = parseWorkflowOptions(rawArgs);
	const preparation = prepareWorkflowCommand({
		subcommand,
		positional,
		stdinText: input.stdinText,
	});
	const store = await WorkflowStore.open({ configRoot });

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
			const validation = await validateWorkflowDocumentInput({
				store,
				document: preparation.document,
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
			const save = await saveWorkflowDocument({
				store,
				options: {
					document: preparation.document,
					expectedContentHash: preparation.expectedContentHash,
					filePath: preparation.filePath,
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
	  }
	| {
			subcommand: "read";
			workflowId: string;
	  }
	| {
			subcommand: "validate";
			document: unknown;
	  }
	| {
			subcommand: "save";
			document: unknown;
			expectedContentHash: string | null;
			filePath: string | null;
	  };

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
	positional: string[];
	stdinText?: string;
}): PreparedWorkflowCommand {
	switch (input.subcommand) {
		case "list":
			assertNoPositionalArgs(input.positional, "workflow.list");
			return { subcommand: "list" };
		case "read":
			if (input.positional.length !== 1) {
				throw new CliError({
					code: "invalid_cli_arguments",
					command: "workflow.read",
					message: "workflow read requires exactly one workflow id argument.",
				});
			}
			return {
				subcommand: "read",
				workflowId: input.positional[0]!,
			};
		case "validate": {
			assertNoPositionalArgs(input.positional, "workflow.validate");
			const envelope = parseJsonEnvelope<WorkflowValidateEnvelope>(
				input.stdinText,
				"workflow.validate",
			);
			if (!hasDocument(envelope)) {
				throw new CliError({
					code: "invalid_cli_input",
					command: "workflow.validate",
					message: "workflow validate expects a JSON object with a document field on stdin.",
				});
			}
			return {
				subcommand: "validate",
				document: envelope.document,
			};
		}
		case "save": {
			assertNoPositionalArgs(input.positional, "workflow.save");
			const envelope = parseJsonEnvelope<WorkflowSaveEnvelope>(
				input.stdinText,
				"workflow.save",
			);
			if (!hasDocument(envelope)) {
				throw new CliError({
					code: "invalid_cli_input",
					command: "workflow.save",
					message: "workflow save expects a JSON object with a document field on stdin.",
				});
			}
			return {
				subcommand: "save",
				document: envelope.document,
				expectedContentHash: envelope.expectedContentHash ?? null,
				filePath: envelope.filePath ?? null,
			};
		}
	}
}

function parseWorkflowOptions(args: string[]) {
	let configRoot: string | undefined;
	const positional: string[] = [];

	for (let index = 0; index < args.length; index += 1) {
		const value = args[index]!;
		if (value === "--config-root") {
			const nextValue = args[index + 1];
			if (!nextValue) {
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
