import { CliError } from "./errors.ts";
import type { CliRunResult, WorkflowCliResponse } from "./types.ts";
import {
	executeWorkflowCommand,
	toWorkflowCliErrorResponse,
} from "./workflow.ts";

export async function runCli(
	args: string[],
	input: { stdinText?: string } = {},
): Promise<CliRunResult> {
	try {
		const response = await executeCli(args, input.stdinText);
		return {
			exitCode: 0,
			stdout: serializeJson(response),
			stderr: "",
		};
	} catch (error) {
		const command = inferWorkflowCommand(args);
		return {
			exitCode: 1,
			stdout: "",
			stderr: serializeJson(toWorkflowCliErrorResponse(error, command)),
		};
	}
}

async function executeCli(
	args: string[],
	stdinText: string | undefined,
): Promise<WorkflowCliResponse> {
	const [rootCommand, ...rest] = args;
	if (rootCommand !== "workflow") {
		throw new CliError({
			code: "invalid_cli_arguments",
			message: "Expected the root CLI command to be workflow.",
		});
	}
	return executeWorkflowCommand({
		args: rest,
		stdinText,
	});
}

function serializeJson(value: WorkflowCliResponse) {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function inferWorkflowCommand(args: string[]) {
	if (args[0] !== "workflow") {
		return undefined;
	}

	switch (args[1]) {
		case "list":
			return "workflow.list" as const;
		case "read":
			return "workflow.read" as const;
		case "validate":
			return "workflow.validate" as const;
		case "save":
			return "workflow.save" as const;
		default:
			return undefined;
	}
}
