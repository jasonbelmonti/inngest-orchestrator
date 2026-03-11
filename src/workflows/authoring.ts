import { lstat, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { compileWorkflowDocument } from "./compiler.ts";
import { WorkflowError, createIssue } from "./errors.ts";
import { hashWorkflowDocument, serializeWorkflowDocument } from "./serialization.ts";
import type { WorkflowStore } from "./store.ts";
import type {
	CompiledWorkflowDocument,
	WorkflowDocument,
	WorkflowRecord,
	WorkflowRepositoryCatalog,
	WorkflowSummary,
} from "./types.ts";
import { parseWorkflowDocument } from "./validation.ts";

const VALIDATION_INPUT_FILE_PATH = "memory://stdin/workflow.json";

export interface ValidatedWorkflowDocument {
	document: WorkflowDocument;
	compiled: CompiledWorkflowDocument;
	contentHash: string;
	filePath: string;
	repoCatalog: WorkflowRepositoryCatalog;
}

export interface SaveWorkflowDocumentOptions {
	document: unknown;
	expectedContentHash?: string | null;
	filePath?: string | null;
}

export interface SaveWorkflowDocumentResult {
	operation: "created" | "updated";
	workflow: WorkflowRecord;
	compiled: CompiledWorkflowDocument;
}

export async function validateWorkflowDocumentInput(input: {
	store: WorkflowStore;
	document: unknown;
	filePath?: string;
}): Promise<ValidatedWorkflowDocument> {
	const repoCatalog = await input.store.readRepositoryCatalog();
	const filePath = input.filePath ?? VALIDATION_INPUT_FILE_PATH;
	const document = parseWorkflowDocument(input.document, {
		filePath,
		repoCatalog,
	});
	const compiled = compileWorkflowDocument({
		document,
		repoCatalog,
		filePath,
	});

	return {
		document,
		compiled,
		contentHash: hashWorkflowDocument(document),
		filePath,
		repoCatalog,
	};
}

export async function saveWorkflowDocument(input: {
	store: WorkflowStore;
	options: SaveWorkflowDocumentOptions;
}): Promise<SaveWorkflowDocumentResult> {
	const validated = await validateWorkflowDocumentInput({
		store: input.store,
		document: input.options.document,
	});
	const saveContext = await loadSaveContext({
		store: input.store,
		workflowId: validated.document.workflowId,
		requestedFilePath: input.options.filePath ?? undefined,
	});

	if (saveContext.duplicateWorkflow) {
		throw new WorkflowError({
			code: "invalid_workflow_document",
			message: `Workflow "${validated.document.workflowId}" already exists in another file.`,
			filePath: saveContext.targetFilePath,
			issues: [
				createIssue(
					"duplicate_workflow_id",
					saveContext.targetFilePath,
					`Workflow id "${validated.document.workflowId}" is already declared in "${saveContext.duplicateWorkflow.filePath}".`,
				),
			],
		});
	}

	assertOptimisticSave({
		expectedContentHash: input.options.expectedContentHash ?? null,
		existingSummary: saveContext.existingSummary,
		targetExists: saveContext.targetExists,
		targetFilePath: saveContext.targetFilePath,
	});
	const fileStats = await persistWorkflowDocument({
		document: validated.document,
		targetFilePath: saveContext.targetFilePath,
	});
	const workflow: WorkflowRecord = {
		workflowId: validated.document.workflowId,
		name: validated.document.name,
		...(validated.document.summary ? { summary: validated.document.summary } : {}),
		updatedAt: fileStats.mtime.toISOString(),
		nodeCount: validated.document.nodes.length,
		edgeCount: validated.document.edges.length,
		contentHash: validated.contentHash,
		filePath: saveContext.targetFilePath,
		document: validated.document,
		repoCatalog: validated.repoCatalog,
	};

	return {
		operation: saveContext.targetExists ? "updated" : "created",
		workflow,
		compiled: validated.compiled,
	};
}

async function loadSaveContext(input: {
	store: WorkflowStore;
	workflowId: string;
	requestedFilePath?: string;
}) {
	const workflowsDirectoryPath = input.store.getWorkflowsDirectoryPath();
	const workflowFilePaths = await input.store.listWorkflowFilePaths();
	const summaries = await readSaveSummaries(input.store, workflowFilePaths);
	const existingWorkflowSummary = summaries.find(
		(summary) => summary.workflowId === input.workflowId,
	);
	const targetFilePath = await resolveSaveTargetPath({
		workflowsDirectoryPath,
		workflowId: input.workflowId,
		existingWorkflowFilePath: existingWorkflowSummary?.filePath,
		requestedFilePath: input.requestedFilePath,
	});
	const existingSummary = summaries.find(
		(summary) => resolve(summary.filePath) === targetFilePath,
	);
	const duplicateWorkflow = summaries.find(
		(summary) =>
			summary.workflowId === input.workflowId &&
			resolve(summary.filePath) !== targetFilePath,
	);
	return {
		targetFilePath,
		existingSummary,
		duplicateWorkflow,
		targetExists: await doesPathExist(targetFilePath),
	};
}

async function resolveSaveTargetPath(input: {
	workflowsDirectoryPath: string;
	workflowId: string;
	existingWorkflowFilePath?: string;
	requestedFilePath?: string;
}) {
	const candidatePath =
		input.requestedFilePath && input.requestedFilePath.length > 0
			? resolve(input.requestedFilePath)
			: input.existingWorkflowFilePath
				? resolve(input.existingWorkflowFilePath)
				: join(input.workflowsDirectoryPath, `${input.workflowId}.json`);
	if (!isAbsolute(candidatePath) || extname(candidatePath) !== ".json") {
		throw new WorkflowError({
			code: "workflow_save_conflict",
			message: "Workflow save target must be a JSON file inside the config-root workflows directory.",
			filePath: candidatePath,
		});
	}
	if (resolve(dirname(candidatePath)) !== resolve(input.workflowsDirectoryPath)) {
		throw new WorkflowError({
			code: "workflow_save_conflict",
			message:
				"Workflow save target must be a top-level JSON file inside the config-root workflows directory.",
			filePath: candidatePath,
		});
	}
	await assertSafeSaveTarget(input.workflowsDirectoryPath, candidatePath);
	return candidatePath;
}

function assertOptimisticSave(input: {
	expectedContentHash: string | null;
	existingSummary: WorkflowSummary | undefined;
	targetExists: boolean;
	targetFilePath: string;
}) {
	if (!input.existingSummary) {
		if (input.expectedContentHash !== null) {
			throw new WorkflowError({
				code: "workflow_save_conflict",
				message: "Cannot apply an optimistic save baseline to a workflow file that does not exist yet.",
				filePath: input.targetFilePath,
			});
		}
		if (!input.targetExists) {
			return;
		}
		return;
	}

	if (input.expectedContentHash === null) {
		throw new WorkflowError({
			code: "workflow_save_conflict",
			message: "Saving an existing workflow requires the previous content hash.",
			filePath: input.targetFilePath,
		});
	}

	if (input.expectedContentHash === input.existingSummary.contentHash) {
		return;
	}

	throw new WorkflowError({
		code: "workflow_save_conflict",
		message: "Workflow content has changed since the caller last read it.",
		filePath: input.targetFilePath,
	});
}

async function readSaveSummaries(store: WorkflowStore, filePaths: string[]) {
	const summaries: WorkflowSummary[] = [];
	for (const filePath of filePaths) {
		try {
			const record = await store.readWorkflowRecordFromFilePath(filePath);
			const { document, repoCatalog, ...summary } = record;
			summaries.push(summary);
		} catch (error) {
			if (error instanceof WorkflowError) {
				continue;
			}
			throw error;
		}
	}
	return summaries;
}

async function assertSafeSaveTarget(
	workflowsDirectoryPath: string,
	targetFilePath: string,
) {
	const workflowsRealPath = await realpath(workflowsDirectoryPath);
	const targetParentRealPath = await realpath(dirname(targetFilePath));
	if (workflowsRealPath !== targetParentRealPath) {
		throw new WorkflowError({
			code: "workflow_save_conflict",
			message:
				"Workflow save target must resolve inside the config-root workflows directory.",
			filePath: targetFilePath,
		});
	}

	try {
		const targetStats = await lstat(targetFilePath);
		if (targetStats.isSymbolicLink()) {
			throw new WorkflowError({
				code: "workflow_save_conflict",
				message: "Workflow save target must not be a symbolic link.",
				filePath: targetFilePath,
			});
		}
	} catch (error) {
		if (isPathNotFoundError(error)) {
			return;
		}
		if (error instanceof WorkflowError) {
			throw error;
		}
		throw new WorkflowError({
			code: "workflow_save_conflict",
			message: "Failed to validate workflow save target.",
			filePath: targetFilePath,
			cause: error,
		});
	}
}

async function doesPathExist(path: string) {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if (isPathNotFoundError(error)) {
			return false;
		}
		throw error;
	}
}

function isPathNotFoundError(error: unknown) {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function persistWorkflowDocument(input: {
	document: WorkflowDocument;
	targetFilePath: string;
}) {
	try {
		await Bun.write(
			input.targetFilePath,
			serializeWorkflowDocument(input.document),
		);
		return await stat(input.targetFilePath);
	} catch (error) {
		throw new WorkflowError({
			code: "workflow_save_failed",
			message: "Failed to persist workflow document.",
			filePath: input.targetFilePath,
			cause: error,
		});
	}
}
