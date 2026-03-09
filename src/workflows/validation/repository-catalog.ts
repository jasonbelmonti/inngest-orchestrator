import { WorkflowError, type WorkflowValidationIssue } from "../errors.ts";
import type {
	WorkflowRepositoryCatalog,
	WorkflowRepositoryCatalogEntry,
} from "../types.ts";
import {
	appendDuplicateIdIssues,
	asNonEmptyString,
	asObject,
	asOptionalString,
	pushInvalidShape,
} from "./shared.ts";

interface ParseRepositoryCatalogOptions {
	filePath: string;
}

export function parseWorkflowRepositoryCatalog(
	input: unknown,
	options: ParseRepositoryCatalogOptions,
): WorkflowRepositoryCatalog {
	const issues: WorkflowValidationIssue[] = [];
	const root = asObject(input, "$", issues);

	const schemaVersion =
		root && root.schemaVersion === 1
			? 1
			: pushInvalidShape(issues, "$.schemaVersion", "schemaVersion must be 1.");
	const repositoriesValue = root?.repositories;
	const repositories = Array.isArray(repositoriesValue)
		? repositoriesValue
		: pushInvalidShape(issues, "$.repositories", "repositories must be an array.");

	const parsedRepositories: WorkflowRepositoryCatalogEntry[] = [];
	if (Array.isArray(repositories)) {
		for (const [index, candidate] of repositories.entries()) {
			const path = `$.repositories[${index}]`;
			const repository = asObject(candidate, path, issues);
			if (!repository) {
				continue;
			}

			const id = asNonEmptyString(repository.id, `${path}.id`, issues);
			const label = asNonEmptyString(repository.label, `${path}.label`, issues);
			const description = asOptionalString(
				repository.description,
				`${path}.description`,
				issues,
			);
			if (!id || !label) {
				continue;
			}
			parsedRepositories.push({
				id,
				label,
				...(description ? { description } : {}),
			});
		}
	}

	appendDuplicateIdIssues({
		entries: parsedRepositories,
		pathPrefix: "$.repositories",
		issueCode: "duplicate_repository_id",
		issues,
	});

	if (issues.length > 0 || schemaVersion !== 1) {
		throw new WorkflowError({
			code: "invalid_repo_catalog",
			message: "Repository catalog validation failed.",
			filePath: options.filePath,
			issues,
		});
	}

	return {
		schemaVersion,
		repositories: parsedRepositories,
	};
}
