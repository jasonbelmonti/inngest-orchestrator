import { stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { compileWorkflowDocument } from "./compiler.ts";
import { WorkflowError, createIssue } from "./errors.ts";
import { hashWorkflowDocument, serializeWorkflowDocument } from "./serialization.ts";
import { WorkflowStore } from "./store.ts";
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
	const summaries = await input.store.listWorkflows();
	const targetFilePath = resolveSaveTargetPath({
		store: input.store,
		summaries,
		workflowId: validated.document.workflowId,
		requestedFilePath: input.options.filePath ?? undefined,
	});
	const existingSummary = summaries.find(
		(summary) => resolve(summary.filePath) === targetFilePath,
	);
	const duplicateWorkflow = summaries.find(
		(summary) =>
			summary.workflowId === validated.document.workflowId &&
			resolve(summary.filePath) !== targetFilePath,
	);

	if (duplicateWorkflow) {
		throw new WorkflowError({
			code: "invalid_workflow_document",
			message: `Workflow "${validated.document.workflowId}" already exists in another file.`,
			filePath: targetFilePath,
			issues: [
				createIssue(
					"duplicate_workflow_id",
					targetFilePath,
					`Workflow id "${validated.document.workflowId}" is already declared in "${duplicateWorkflow.filePath}".`,
				),
			],
		});
	}

	assertOptimisticSave(input.options.expectedContentHash ?? null, existingSummary, targetFilePath);

	await Bun.write(targetFilePath, serializeWorkflowDocument(validated.document));
	const fileStats = await stat(targetFilePath);
	const workflow: WorkflowRecord = {
		workflowId: validated.document.workflowId,
		name: validated.document.name,
		...(validated.document.summary ? { summary: validated.document.summary } : {}),
		updatedAt: fileStats.mtime.toISOString(),
		nodeCount: validated.document.nodes.length,
		edgeCount: validated.document.edges.length,
		contentHash: validated.contentHash,
		filePath: targetFilePath,
		document: validated.document,
		repoCatalog: validated.repoCatalog,
	};

	return {
		operation: existingSummary ? "updated" : "created",
		workflow,
		compiled: validated.compiled,
	};
}

function resolveSaveTargetPath(input: {
	store: WorkflowStore;
	summaries: WorkflowSummary[];
	workflowId: string;
	requestedFilePath?: string;
}) {
	const workflowsDirectoryPath = input.store.getWorkflowsDirectoryPath();
	const existingSummary = input.summaries.find(
		(summary) => summary.workflowId === input.workflowId,
	);
	const candidatePath =
		input.requestedFilePath && input.requestedFilePath.length > 0
			? resolve(input.requestedFilePath)
			: existingSummary
				? resolve(existingSummary.filePath)
				: join(workflowsDirectoryPath, `${input.workflowId}.json`);
	const relativePath = relative(workflowsDirectoryPath, candidatePath);
	if (
		!isAbsolute(candidatePath) ||
		relativePath.startsWith("..") ||
		relativePath.length === 0 ||
		extname(candidatePath) !== ".json"
	) {
		throw new WorkflowError({
			code: "workflow_save_conflict",
			message: "Workflow save target must be a JSON file inside the config-root workflows directory.",
			filePath: candidatePath,
		});
	}
	return candidatePath;
}

function assertOptimisticSave(
	expectedContentHash: string | null,
	existingSummary: WorkflowSummary | undefined,
	targetFilePath: string,
) {
	if (!existingSummary) {
		if (expectedContentHash === null) {
			return;
		}
		throw new WorkflowError({
			code: "workflow_save_conflict",
			message: "Cannot apply an optimistic save baseline to a workflow file that does not exist yet.",
			filePath: targetFilePath,
		});
	}

	if (expectedContentHash === null) {
		throw new WorkflowError({
			code: "workflow_save_conflict",
			message: "Saving an existing workflow requires the previous content hash.",
			filePath: targetFilePath,
		});
	}

	if (expectedContentHash === existingSummary.contentHash) {
		return;
	}

	throw new WorkflowError({
		code: "workflow_save_conflict",
		message: "Workflow content has changed since the caller last read it.",
		filePath: targetFilePath,
	});
}
