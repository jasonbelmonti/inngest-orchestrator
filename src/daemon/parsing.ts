import { DaemonHttpError } from "./errors.ts";
import type { RunControlRequest } from "./types.ts";

const MAX_CONTROL_TEXT_BYTES = 64 * 1024;
const MAX_CONTROL_IDENTIFIER_BYTES = 64 * 1024;
const textEncoder = new TextEncoder();

export async function readJsonBody(request: Request) {
	assertJsonContentType(request);

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
				approvalId: requireBoundedNonEmptyString(
					input.approvalId,
					"approvalId",
				),
				stepId: requireBoundedNonEmptyString(input.stepId, "stepId"),
				...parseOptionalStringField(
					input,
					"message",
					'"message" must be a string when provided.',
				),
			};
		case "resolve_approval":
			return {
				action: "resolve_approval",
				approvalId: requireBoundedNonEmptyString(
					input.approvalId,
					"approvalId",
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

function requireBoundedNonEmptyString(input: unknown, fieldName: string) {
	if (typeof input === "string" && input.trim().length > 0) {
		assertMaxUtf8Bytes(input, fieldName, MAX_CONTROL_IDENTIFIER_BYTES);
		return input;
	}

	throw invalidControlRequest(`"${fieldName}" must be a non-empty string.`);
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

	assertMaxUtf8Bytes(input[fieldName], fieldName, MAX_CONTROL_TEXT_BYTES);

	return { [fieldName]: input[fieldName] } as Record<string, string>;
}

function assertMaxUtf8Bytes(
	value: string,
	fieldName: string,
	maxBytes: number,
) {
	if (textEncoder.encode(value).byteLength > maxBytes) {
		throw invalidControlRequest(
			`"${fieldName}" must be at most ${maxBytes} UTF-8 bytes.`,
		);
	}
}

function assertJsonContentType(request: Request) {
	const contentType = request.headers.get("content-type");
	if (!contentType) {
		throw new DaemonHttpError({
			status: 415,
			code: "unsupported_media_type",
			message: 'Mutating requests must use "Content-Type: application/json".',
		});
	}

	const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
	if (mediaType !== "application/json") {
		throw new DaemonHttpError({
			status: 415,
			code: "unsupported_media_type",
			message: 'Mutating requests must use "Content-Type: application/json".',
		});
	}
}
