export type CliErrorCode = "invalid_cli_arguments" | "invalid_cli_input";

export class CliError extends Error {
	readonly code: CliErrorCode;
	readonly command?: string;

	constructor(input: { code: CliErrorCode; message: string; command?: string }) {
		super(input.message);
		this.name = "CliError";
		this.code = input.code;
		this.command = input.command;
	}
}
