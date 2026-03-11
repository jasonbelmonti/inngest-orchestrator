import { DaemonHttpError } from "./errors.ts";

export type DaemonRouteMatch =
	| { kind: "runs" }
	| { kind: "run-detail"; runId: string }
	| { kind: "run-control"; runId: string }
	| { kind: "not-found"; pathname: string };

export function matchDaemonRoute(pathname: string): DaemonRouteMatch {
	const segments = pathname.split("/").filter(Boolean).map(decodePathSegment);
	const runId = segments[1];

	if (segments.length === 1 && segments[0] === "runs") {
		return { kind: "runs" };
	}

	if (segments.length === 2 && segments[0] === "runs" && runId) {
		return { kind: "run-detail", runId };
	}

	if (
		segments.length === 3 &&
		segments[0] === "runs" &&
		segments[2] === "control" &&
		runId
	) {
		return { kind: "run-control", runId };
	}

	return { kind: "not-found", pathname };
}

function decodePathSegment(input: string) {
	try {
		return decodeURIComponent(input);
	} catch (error) {
		throw new DaemonHttpError({
			status: 400,
			code: "invalid_http_input",
			message: "Request path contains invalid percent-encoding.",
			cause: error,
		});
	}
}
