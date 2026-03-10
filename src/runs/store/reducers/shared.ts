import { RunStoreError } from "../errors.ts";
import type { RunProjectionRecord, StoredRunEvent } from "../types.ts";

export function assertRunState(
	state: RunProjectionRecord | null,
	runId: string,
) {
	if (!state) {
		throw new RunStoreError({
			code: "run_store_not_found",
			message: `Run "${runId}" was not found.`,
		});
	}
	return state;
}

export function assertRunStatus(
	state: RunProjectionRecord,
	allowedStatuses: RunProjectionRecord["status"][],
	eventType: StoredRunEvent["type"],
) {
	if (allowedStatuses.includes(state.status)) {
		return;
	}
	throw new RunStoreError({
		code: "run_store_invalid_transition",
		message: `Cannot apply "${eventType}" while run "${state.runId}" is "${state.status}".`,
	});
}
