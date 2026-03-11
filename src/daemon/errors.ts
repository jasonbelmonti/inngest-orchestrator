import { RunLaunchError } from "../runs/errors.ts";
import { RunStoreError } from "../runs/store/errors.ts";
import type { DaemonErrorBody } from "./types.ts";

interface DaemonHttpErrorInput extends DaemonErrorBody {
	status: number;
	cause?: unknown;
}

export class DaemonHttpError extends Error {
	readonly status: number;
	readonly code: string;
	readonly issues?: DaemonErrorBody["issues"];
	readonly runId?: string;

	constructor(input: DaemonHttpErrorInput) {
		super(input.message);
		this.name = "DaemonHttpError";
		this.status = input.status;
		this.code = input.code;
		this.issues = input.issues;
		this.runId = input.runId;
		if (input.cause !== undefined) {
			this.cause = input.cause;
		}
	}
}

export function toDaemonHttpError(
	error: unknown,
	input: { runId?: string } = {},
) {
	if (error instanceof DaemonHttpError) {
		return error;
	}

	if (error instanceof RunLaunchError) {
		return new DaemonHttpError({
			status: 400,
			code: error.code,
			message: error.message,
			issues: error.issues,
			cause: error,
		});
	}

	if (error instanceof RunStoreError) {
		return new DaemonHttpError({
			status: error.code === "run_store_not_found" ? 404 : 409,
			code: error.code,
			message: error.message,
			runId: input.runId,
			cause: error,
		});
	}

	return new DaemonHttpError({
		status: 500,
		code: "internal_error",
		message: "The daemon encountered an unexpected error.",
		runId: input.runId,
		cause: error,
	});
}
