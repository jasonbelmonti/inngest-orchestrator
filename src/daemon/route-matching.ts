export type DaemonRouteMatch =
	| { kind: "runs" }
	| { kind: "run-detail"; runId: string }
	| { kind: "run-control"; runId: string }
	| { kind: "not-found"; pathname: string };

export function matchDaemonRoute(pathname: string): DaemonRouteMatch {
	const segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
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
