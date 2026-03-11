import { readdir, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import {
	REPOSITORIES_DIRECTORY_NAME,
	REPOSITORY_CATALOG_FILE_NAME,
	WORKFLOW_CONFIG_ROOT_ENV,
	WORKFLOWS_DIRECTORY_NAME,
} from "./constants.ts";
import { WorkflowError, createIssue } from "./errors.ts";
import { hashWorkflowDocument } from "./serialization.ts";
import {
	parseWorkflowDocument,
	parseWorkflowRepositoryCatalog,
} from "./validation.ts";
import type {
	WorkflowRecord,
	WorkflowRepositoryCatalog,
	WorkflowSummary,
} from "./types.ts";

interface OpenWorkflowStoreOptions {
	configRoot?: string;
}

export class WorkflowStore {
	static async open(options: OpenWorkflowStoreOptions = {}) {
		const configRoot = await resolveWorkflowConfigRoot(options.configRoot);
		return new WorkflowStore(configRoot);
	}

	private readonly repositoryCatalogPath: string;
	private readonly workflowsDirectoryPath: string;
	private repositoryCatalogPromise: Promise<WorkflowRepositoryCatalog> | null =
		null;

	private constructor(readonly configRoot: string) {
		this.repositoryCatalogPath = join(
			this.configRoot,
			REPOSITORIES_DIRECTORY_NAME,
			REPOSITORY_CATALOG_FILE_NAME,
		);
		this.workflowsDirectoryPath = join(
			this.configRoot,
			WORKFLOWS_DIRECTORY_NAME,
		);
	}

	async readRepositoryCatalog() {
		if (!this.repositoryCatalogPromise) {
			this.repositoryCatalogPromise = this.loadRepositoryCatalog();
		}
		return this.repositoryCatalogPromise;
	}

	getWorkflowsDirectoryPath() {
		return this.workflowsDirectoryPath;
	}

	async listWorkflows(): Promise<WorkflowSummary[]> {
		const records = await this.loadWorkflowRecords();
		return records
			.map(({ document, repoCatalog, ...summary }) => summary)
			.sort((left, right) => left.workflowId.localeCompare(right.workflowId));
	}

	async listWorkflowFilePaths() {
		return this.resolveWorkflowFilePaths();
	}

	async readWorkflowRecordFromFilePath(filePath: string) {
		const repoCatalog = await this.readRepositoryCatalog();
		return this.loadWorkflowRecord(filePath, repoCatalog);
	}

	async readWorkflow(workflowId: string): Promise<WorkflowRecord> {
		const records = await this.loadWorkflowRecords();
		const record = records.find(
			(candidate) => candidate.workflowId === workflowId,
		);
		if (!record) {
			throw new WorkflowError({
				code: "workflow_not_found",
				message: `Workflow "${workflowId}" was not found.`,
			});
		}
		return record;
	}

	private async loadRepositoryCatalog() {
		try {
			const file = Bun.file(this.repositoryCatalogPath);
			if (!(await file.exists())) {
				throw new WorkflowError({
					code: "repository_catalog_not_found",
					message: "Config root is missing repos/workspace.repos.json.",
					filePath: this.repositoryCatalogPath,
				});
			}
			const source = await file.text();
			const raw = parseJsonFile({
				source,
				filePath: this.repositoryCatalogPath,
			});
			return parseWorkflowRepositoryCatalog(raw, {
				filePath: this.repositoryCatalogPath,
			});
		} catch (error) {
			if (error instanceof WorkflowError) {
				throw error;
			}
			throw new WorkflowError({
				code: "repository_catalog_not_found",
				message: "Failed to load repository catalog.",
				filePath: this.repositoryCatalogPath,
				cause: error,
			});
		}
	}

	private async loadWorkflowRecords(): Promise<WorkflowRecord[]> {
		const repoCatalog = await this.readRepositoryCatalog();
		const filePaths = await this.resolveWorkflowFilePaths();
		const records = await Promise.all(
			filePaths.map((filePath) =>
				this.loadWorkflowRecord(filePath, repoCatalog),
			),
		);

		const duplicateIssues = findDuplicateWorkflowIds(records);
		if (duplicateIssues.length > 0) {
			throw new WorkflowError({
				code: "invalid_workflow_document",
				message: "Duplicate workflow ids were found in the config root.",
				issues: duplicateIssues,
			});
		}

		return records.sort((left, right) =>
			left.workflowId.localeCompare(right.workflowId),
		);
	}

	private async resolveWorkflowFilePaths() {
		try {
			const stats = await stat(this.workflowsDirectoryPath);
			if (!stats.isDirectory()) {
				throw new WorkflowError({
					code: "workflows_directory_not_found",
					message: "Config root workflows path is not a directory.",
					filePath: this.workflowsDirectoryPath,
				});
			}
		} catch (error) {
			if (error instanceof WorkflowError) {
				throw error;
			}
			throw new WorkflowError({
				code: "workflows_directory_not_found",
				message: "Config root is missing the workflows directory.",
				filePath: this.workflowsDirectoryPath,
				cause: error,
			});
		}

		const entries = await readdir(this.workflowsDirectoryPath, {
			withFileTypes: true,
		});
		return entries
			.filter((entry) => entry.isFile() && extname(entry.name) === ".json")
			.map((entry) => join(this.workflowsDirectoryPath, entry.name))
			.sort((left, right) => basename(left).localeCompare(basename(right)));
	}

	private async loadWorkflowRecord(
		filePath: string,
		repoCatalog: WorkflowRepositoryCatalog,
	): Promise<WorkflowRecord> {
		const file = Bun.file(filePath);
		const source = await file.text();
		const raw = parseJsonFile({ source, filePath });
		const document = parseWorkflowDocument(raw, {
			filePath,
			repoCatalog,
		});
		const fileStats = await stat(filePath);
		return {
			workflowId: document.workflowId,
			name: document.name,
			...(document.summary ? { summary: document.summary } : {}),
			updatedAt: fileStats.mtime.toISOString(),
			nodeCount: document.nodes.length,
			edgeCount: document.edges.length,
			contentHash: hashWorkflowDocument(document),
			filePath,
			document,
			repoCatalog,
		};
	}
}

export async function resolveWorkflowConfigRoot(configRoot?: string) {
	const candidate = configRoot ?? Bun.env[WORKFLOW_CONFIG_ROOT_ENV];
	if (!candidate) {
		throw new WorkflowError({
			code: "config_root_unset",
			message:
				"No config root was provided. Pass --config-root or set AGENT_ORCHESTRATOR_CONFIG_ROOT.",
		});
	}

	const resolvedPath = resolve(candidate);
	try {
		const stats = await stat(resolvedPath);
		if (!stats.isDirectory()) {
			throw new WorkflowError({
				code: "config_root_not_found",
				message: "Config root path is not a directory.",
				filePath: resolvedPath,
			});
		}
		return resolvedPath;
	} catch (error) {
		if (error instanceof WorkflowError) {
			throw error;
		}
		throw new WorkflowError({
			code: "config_root_not_found",
			message: "Config root path does not exist.",
			filePath: resolvedPath,
			cause: error,
		});
	}
}

function parseJsonFile(input: { source: string; filePath: string }) {
	try {
		return JSON.parse(input.source) as unknown;
	} catch (error) {
		throw new WorkflowError({
			code: "invalid_json",
			message: "Failed to parse JSON file.",
			filePath: input.filePath,
			cause: error,
		});
	}
}

function findDuplicateWorkflowIds(records: WorkflowRecord[]) {
	const seen = new Map<string, string>();
	const issues = [];
	for (const record of records) {
		const firstFilePath = seen.get(record.workflowId);
		if (!firstFilePath) {
			seen.set(record.workflowId, record.filePath);
			continue;
		}
		issues.push(
			createIssue(
				"duplicate_workflow_id",
				record.filePath,
				`Workflow id "${record.workflowId}" is already declared in "${firstFilePath}".`,
			),
		);
	}
	return issues;
}
