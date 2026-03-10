import { basename, sep } from "node:path";
import { compileWorkflowDocument } from "../workflows/compiler.ts";
import { WorkflowError, createIssue } from "../workflows/errors.ts";
import { WorkflowStore } from "../workflows/store.ts";
import type { WorkflowRecord } from "../workflows/types.ts";
import { RunLaunchError, createRunLaunchIssue } from "./errors.ts";
import { parseRunLaunchRequest } from "./launch-input.ts";
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
		await store.readRepositoryCatalog();
		const workflow = await readWorkflowForLaunch(store, input.workflowId);
		assertWorkflowIsExecutable(workflow);
		return { store, workflow };
	} catch (error) {
		throw toRunLaunchError(error, {
			configRoot: input.configRoot,
			workflowId: input.workflowId,
		});
	}
}

async function readWorkflowForLaunch(
	store: WorkflowStore,
	workflowId: string,
): Promise<WorkflowRecord> {
	const workflowFilePaths = await store.listWorkflowFilePaths();
	const matchingRecords: WorkflowRecord[] = [];
	const matchingErrors: WorkflowError[] = [];

	for (const filePath of workflowFilePaths) {
		try {
			const record = await store.readWorkflowRecordFromFilePath(filePath);
			if (record.workflowId === workflowId) {
				matchingRecords.push(record);
			}
		} catch (error) {
			if (!(error instanceof WorkflowError)) {
				throw error;
			}
			if (await matchesRequestedWorkflow(filePath, workflowId)) {
				matchingErrors.push(error);
			}
		}
	}

	if (matchingRecords.length === 1) {
		return matchingRecords[0]!;
	}

	if (matchingRecords.length === 0) {
		const matchingError = matchingErrors[0];
		if (matchingError) {
			throw matchingError;
		}
		throw new WorkflowError({
			code: "workflow_not_found",
			message: `Workflow "${workflowId}" was not found.`,
		});
	}

	if (matchingRecords.length > 1) {
		const firstRecord = matchingRecords[0]!;
		throw new WorkflowError({
			code: "invalid_workflow_document",
			message: `Workflow "${workflowId}" is declared in multiple files.`,
			filePath: firstRecord.filePath,
			issues: matchingRecords.slice(1).map((record) =>
				createIssue(
					"duplicate_workflow_id",
					record.filePath,
					`Workflow id "${workflowId}" is already declared in "${firstRecord.filePath}".`,
				),
			),
		});
	}

	return matchingRecords[0]!;
}

async function matchesRequestedWorkflow(filePath: string, workflowId: string) {
	try {
		const source = await Bun.file(filePath).text();
		const parsed = JSON.parse(source) as unknown;
		if (
			parsed !== null &&
			typeof parsed === "object" &&
			"workflowId" in parsed &&
			typeof parsed.workflowId === "string"
		) {
			return parsed.workflowId === workflowId;
		}
	} catch {
		return basename(filePath, ".json") === workflowId;
	}

	return basename(filePath, ".json") === workflowId;
}

function assertWorkflowIsExecutable(workflow: WorkflowRecord) {
	compileWorkflowDocument({
		document: workflow.document,
		repoCatalog: workflow.repoCatalog,
		filePath: workflow.filePath,
	});
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

	if (
		error.code === "invalid_workflow_document" ||
		(error.code === "invalid_json" &&
			isWorkflowFileError(error))
	) {
		return new RunLaunchError({
			code: "invalid_run_launch_input",
			message: `Workflow "${input.workflowId}" is invalid.`,
			issues: createWorkflowIssues(error, "workflow_invalid"),
			cause: error,
		});
	}

	if (error.code === "invalid_executable_workflow") {
		return new RunLaunchError({
			code: "invalid_run_launch_input",
			message: `Workflow "${input.workflowId}" cannot be executed.`,
			issues: createWorkflowIssues(error, "workflow_not_executable"),
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
				error.filePath,
			),
		],
		cause: error,
	});
}

function isWorkflowFileError(error: WorkflowError) {
	if (!error.filePath) {
		return false;
	}
	return error.filePath.includes(`${sep}workflows${sep}`);
}

function createWorkflowIssues(
	error: WorkflowError,
	code: "workflow_invalid" | "workflow_not_executable",
) {
	if (error.issues && error.issues.length > 0) {
		return error.issues.map((issue) =>
			createRunLaunchIssue(code, issue.path, issue.message, error.filePath),
		);
	}

	return [createRunLaunchIssue(code, "$", error.message, error.filePath)];
}
