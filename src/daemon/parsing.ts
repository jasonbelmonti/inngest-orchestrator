import { DaemonHttpError } from "./errors.ts";
import type { RunControlRequest } from "./types.ts";

export async function readJsonBody(request: Request) {
	try {
		return await request.json();
	} catch (error) {
		throw new DaemonHttpError({
			status: 400,
			code: "invalid_json_body",
			message: "Request body must be valid JSON.",
			cause: error,
		});
	}
}

export function parseRunControlRequest(input: unknown): RunControlRequest {
	if (!isRecord(input)) {
		throw invalidControlRequest("Request body must be a JSON object.");
	}

	switch (input.action) {
		case "cancel":
			if ("reason" in input && typeof input.reason !== "string") {
				throw invalidControlRequest('"reason" must be a string when provided.');
			}
			return typeof input.reason === "string"
				? { action: "cancel", reason: input.reason }
				: { action: "cancel" };
		case "request_approval":
			return {
				action: "request_approval",
				approvalId: requireNonEmptyString(
					input.approvalId,
					'"approvalId" must be a non-empty string.',
				),
				stepId: requireNonEmptyString(
					input.stepId,
					'"stepId" must be a non-empty string.',
				),
				...(typeof input.message === "string"
					? { message: input.message }
					: {}),
			};
		case "resolve_approval":
			return {
				action: "resolve_approval",
				approvalId: requireNonEmptyString(
					input.approvalId,
					'"approvalId" must be a non-empty string.',
				),
				decision: requireDecision(input.decision),
				...(typeof input.comment === "string"
					? { comment: input.comment }
					: {}),
			};
		default:
			throw invalidControlRequest(
				'"action" must be one of "cancel", "request_approval", or "resolve_approval".',
			);
	}
}

function requireDecision(input: unknown) {
	if (input === "approved" || input === "rejected") {
		return input;
	}

	throw invalidControlRequest('"decision" must be "approved" or "rejected".');
}

function requireNonEmptyString(input: unknown, message: string) {
	if (typeof input === "string" && input.length > 0) {
		return input;
	}

	throw invalidControlRequest(message);
}

function invalidControlRequest(message: string) {
	return new DaemonHttpError({
		status: 400,
		code: "invalid_http_input",
		message,
	});
}

function isRecord(input: unknown): input is Record<string, unknown> {
	return typeof input === "object" && input !== null && !Array.isArray(input);
}
