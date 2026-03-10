import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type {
	WorkflowRepositoryBinding,
	WorkflowRepositoryCatalogEntry,
} from "../workflows/types.ts";
import { RunLaunchError, createRunLaunchIssue } from "./errors.ts";
import type { RunLaunchIssue } from "./errors.ts";
import type { ResolvedRunRepositoryBinding } from "./types.ts";

export async function resolveRepositoryBindings(
	declaredRepositories: WorkflowRepositoryBinding[],
	repositoryCatalog: WorkflowRepositoryCatalogEntry[],
	inputBindings: Record<string, string>,
) {
	const issues = validateUnknownRepoBindings(declaredRepositories, inputBindings);
	const resolvedBindings: ResolvedRunRepositoryBinding[] = [];
	const labelsByRepoId = new Map(
		repositoryCatalog.map((repository) => [repository.id, repository.label]),
	);

	for (const declaredRepository of declaredRepositories) {
		const bindingPath = inputBindings[declaredRepository.id];
		if (bindingPath === undefined) {
			if (declaredRepository.required) {
				issues.push(
					createRunLaunchIssue(
						"missing_required_repo_binding",
						`$.repoBindings.${declaredRepository.id}`,
						`Missing required repo binding for "${declaredRepository.id}".`,
					),
				);
				continue;
			}
			resolvedBindings.push({
				repoId: declaredRepository.id,
				label:
					declaredRepository.label ??
					labelsByRepoId.get(declaredRepository.id) ??
					declaredRepository.id,
				required: false,
				status: "unbound_optional",
				resolvedPath: null,
			});
			continue;
		}

		const resolvedPath = await resolveRepositoryPath(
			declaredRepository.id,
			bindingPath,
			issues,
		);
		if (!resolvedPath) {
			continue;
		}

		resolvedBindings.push({
			repoId: declaredRepository.id,
			label:
				declaredRepository.label ??
				labelsByRepoId.get(declaredRepository.id) ??
				declaredRepository.id,
			required: declaredRepository.required,
			status: "resolved",
			resolvedPath,
		});
	}

	if (issues.length > 0) {
		throw new RunLaunchError({
			code: "repo_binding_resolution_failed",
			message: "Repo binding resolution failed.",
			issues: issues.sort((left, right) => left.path.localeCompare(right.path)),
		});
	}

	return resolvedBindings;
}

function validateUnknownRepoBindings(
	declaredRepositories: WorkflowRepositoryBinding[],
	inputBindings: Record<string, string>,
) {
	const declaredRepoIds = new Set(
		declaredRepositories.map((repository) => repository.id),
	);
	const issues: RunLaunchIssue[] = [];

	for (const repoId of Object.keys(inputBindings).sort()) {
		if (declaredRepoIds.has(repoId)) {
			continue;
		}
		issues.push(
			createRunLaunchIssue(
				"unknown_repo_binding",
				`$.repoBindings.${repoId}`,
				`Repo binding "${repoId}" is not declared by the workflow.`,
			),
		);
	}

	return issues;
}

async function resolveRepositoryPath(
	repoId: string,
	bindingPath: string,
	issues: RunLaunchIssue[],
) {
	if (!isAbsolute(bindingPath)) {
		issues.push(
			createRunLaunchIssue(
				"repo_binding_path_not_absolute",
				`$.repoBindings.${repoId}`,
				`Repo binding "${repoId}" must be an absolute path.`,
			),
		);
		return null;
	}

	const resolvedPath = resolve(bindingPath);
	try {
		const pathStats = await stat(resolvedPath);
		if (!pathStats.isDirectory()) {
			issues.push(
				createRunLaunchIssue(
					"repo_binding_path_not_directory",
					`$.repoBindings.${repoId}`,
					`Repo binding "${repoId}" must point to an existing directory.`,
				),
			);
			return null;
		}
		return resolvedPath;
	} catch (error) {
		if (isPathNotFoundError(error)) {
			issues.push(
				createRunLaunchIssue(
					"repo_binding_path_not_found",
					`$.repoBindings.${repoId}`,
					`Repo binding "${repoId}" must point to an existing directory.`,
				),
			);
			return null;
		}
		throw new RunLaunchError({
			code: "repo_binding_resolution_failed",
			message: `Failed to validate repo binding "${repoId}".`,
			issues: [
				createRunLaunchIssue(
					"invalid_repo_binding_path",
					`$.repoBindings.${repoId}`,
					`Failed to validate repo binding "${repoId}".`,
				),
			],
			cause: error,
		});
	}
}

function isPathNotFoundError(error: unknown) {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}
