import { WorkflowStore } from "../workflows/store.ts";
import { WorkflowError } from "../workflows/errors.ts";
import { parseRunLaunchRequest } from "./launch-input.ts";
import { RunLaunchError, createRunLaunchIssue } from "./errors.ts";
import { resolveRepositoryBindings } from "./repository-resolution.ts";
import type { ResolvedRunLaunchRequest } from "./types.ts";

export async function resolveRunLaunchRequest(
	input: unknown,
): Promise<ResolvedRunLaunchRequest> {
	const request = parseRunLaunchRequest(input);
	const { store, workflow } = await loadWorkflowLaunchContext(request);
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

async function loadWorkflowLaunchContext(input: {
	configRoot: string;
	workflowId: string;
}) {
	try {
		const store = await WorkflowStore.open({ configRoot: input.configRoot });
		const workflow = await store.readWorkflow(input.workflowId);
		return { store, workflow };
	} catch (error) {
		throw toRunLaunchError(error, input);
	}
}

function toRunLaunchError(
	error: unknown,
	input: { configRoot: string; workflowId: string },
) {
	if (!(error instanceof WorkflowError)) {
		return error;
	}

	if (error.code === "workflow_not_found") {
		return new RunLaunchError({
			code: "invalid_run_launch_input",
			message: `Workflow "${input.workflowId}" was not found in the config root.`,
			issues: [
				createRunLaunchIssue(
					"workflow_not_found",
					"$.workflowId",
					`Workflow "${input.workflowId}" was not found in the config root.`,
				),
			],
			cause: error,
		});
	}

	return new RunLaunchError({
		code: "invalid_run_launch_input",
		message: "Failed to load the workflow config root.",
		issues: [
			createRunLaunchIssue(
				"config_root_invalid",
				"$.configRoot",
				error.message,
			),
		],
		cause: error,
	});
}
