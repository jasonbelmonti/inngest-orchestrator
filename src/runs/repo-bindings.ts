import { WorkflowStore } from "../workflows/store.ts";
import { parseRunLaunchRequest } from "./launch-input.ts";
import { resolveRepositoryBindings } from "./repository-resolution.ts";
import type { ResolvedRunLaunchRequest } from "./types.ts";

export async function resolveRunLaunchRequest(
	input: unknown,
): Promise<ResolvedRunLaunchRequest> {
	const request = parseRunLaunchRequest(input);
	const store = await WorkflowStore.open({ configRoot: request.configRoot });
	const workflow = await store.readWorkflow(request.workflowId);
	const repoBindings = await resolveRepositoryBindings(
		workflow.document.repositories,
		workflow.repoCatalog.repositories,
		request.repoBindings,
	);

	return {
		configRoot: store.configRoot,
		workflow: {
			workflowId: workflow.workflowId,
			name: workflow.name,
			...(workflow.summary ? { summary: workflow.summary } : {}),
			contentHash: workflow.contentHash,
			filePath: workflow.filePath,
		},
		repoBindings,
	};
}
