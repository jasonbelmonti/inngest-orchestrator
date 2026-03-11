import { RunStoreError } from "../errors.ts";
import type {
	RunArtifactRecord,
	RunProjectionRecord,
	StoredRunEvent,
} from "../types.ts";
import { assertRunState, assertRunStatus } from "./shared.ts";

export function reduceArtifactCreated(
	state: RunProjectionRecord | null,
	event: Extract<StoredRunEvent, { type: "artifact.created" }>,
): RunProjectionRecord {
	const existing = assertRunState(state, event.runId);
	assertRunStatus(
		existing,
		["running", "waiting_for_approval"],
		event.type,
	);
	if (existing.artifacts.some((artifact) => artifact.artifactId === event.artifactId)) {
		throw new RunStoreError({
			code: "run_store_conflict",
			message: `Artifact "${event.artifactId}" already exists for run "${event.runId}".`,
		});
	}
	const artifact: RunArtifactRecord = {
		artifactId: event.artifactId,
		runId: event.runId,
		stepId: event.stepId,
		kind: event.kind,
		repoId: event.repoId ?? null,
		relativePath: event.relativePath,
		createdAt: event.occurredAt,
		metadata: event.metadata ?? null,
	};
	return {
		...existing,
		updatedAt: event.occurredAt,
		latestEventSequence: event.sequence,
		artifacts: [...existing.artifacts, artifact],
	};
}
