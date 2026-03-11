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
			return {
				action: "cancel",
				...parseOptionalStringField(
					input,
					"reason",
					'"reason" must be a string when provided.',
				),
			};
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
				...parseOptionalStringField(
					input,
					"message",
					'"message" must be a string when provided.',
				),
			};
		case "resolve_approval":
			return {
				action: "resolve_approval",
				approvalId: requireNonEmptyString(
					input.approvalId,
					'"approvalId" must be a non-empty string.',
				),
				decision: requireDecision(input.decision),
				...parseOptionalStringField(
					input,
					"comment",
					'"comment" must be a string when provided.',
				),
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

function parseOptionalStringField(
	input: Record<string, unknown>,
	fieldName: string,
	message: string,
) {
	if (!(fieldName in input) || input[fieldName] === undefined) {
		return {};
	}

	if (typeof input[fieldName] !== "string") {
		throw invalidControlRequest(message);
	}

	return { [fieldName]: input[fieldName] } as Record<string, string>;
}
