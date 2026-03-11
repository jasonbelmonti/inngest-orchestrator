import type { DaemonHttpError } from "./errors.ts";

export function successResponse(status: number, body: Record<string, unknown>) {
	return jsonResponse({ ok: true, ...body }, status);
}

export function errorResponse(error: DaemonHttpError) {
	return jsonResponse(
		{
			ok: false,
			error: {
				code: error.code,
				message: error.message,
				...(error.issues ? { issues: error.issues } : {}),
				...(error.runId ? { runId: error.runId } : {}),
			},
		},
		error.status,
	);
}

function jsonResponse(body: Record<string, unknown>, status: number) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
		},
	});
}
