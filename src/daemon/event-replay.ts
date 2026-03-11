import type { SQLiteRunStore } from "../runs/store/sqlite-store.ts";
import type { RunProjectionRecord } from "../runs/store/types.ts";
import { DaemonHttpError } from "./errors.ts";

export interface ResolvedRunEventReplay {
	afterSequence: number | null;
}

export function resolveRunEventReplay(
	request: Request,
	store: SQLiteRunStore,
	run: RunProjectionRecord,
): ResolvedRunEventReplay {
	const lastEventId = parseLastEventId(request, run.runId);
	if (lastEventId === null) {
		return {
			afterSequence: null,
		};
	}

	if (lastEventId > run.latestEventSequence) {
		throw new DaemonHttpError({
			status: 400,
			code: "invalid_http_input",
			message:
				'"Last-Event-ID" cannot be greater than the latest persisted event sequence for this run.',
			runId: run.runId,
		});
	}

	return {
		afterSequence: lastEventId,
	};
}

function parseLastEventId(request: Request, runId: string) {
	const raw = request.headers.get("last-event-id");
	if (raw === null) {
		return null;
	}

	if (!/^\d+$/.test(raw)) {
		throw new DaemonHttpError({
			status: 400,
			code: "invalid_http_input",
			message: '"Last-Event-ID" must be a non-negative integer.',
			runId,
		});
	}

	const parsed = Number(raw);
	if (!Number.isSafeInteger(parsed)) {
		throw new DaemonHttpError({
			status: 400,
			code: "invalid_http_input",
			message: '"Last-Event-ID" must be a safe integer.',
			runId,
		});
	}

	return parsed;
}
