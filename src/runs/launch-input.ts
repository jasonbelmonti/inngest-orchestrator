import { RunLaunchError, createRunLaunchIssue } from "./errors.ts";
import type { RunLaunchIssue } from "./errors.ts";
import type { RunLaunchRequest } from "./types.ts";

export function parseRunLaunchRequest(input: unknown): RunLaunchRequest {
	const issues: RunLaunchIssue[] = [];
	if (!isObject(input)) {
		throw new RunLaunchError({
			code: "invalid_run_launch_input",
			message: "Run launch request must be a JSON object.",
			issues: [
				createRunLaunchIssue(
					"invalid_shape",
					"$",
					"Run launch request must be a JSON object.",
				),
			],
		});
	}

	const workflowId = readRequiredString(input.workflowId, "$.workflowId", issues);
	const configRoot = readRequiredString(input.configRoot, "$.configRoot", issues);
	const repoBindings = readRepoBindings(input.repoBindings, issues);

	if (issues.length > 0) {
		throw new RunLaunchError({
			code: "invalid_run_launch_input",
			message: "Run launch request validation failed.",
			issues,
		});
	}

	return {
		workflowId,
		configRoot,
		repoBindings,
	};
}

function readRequiredString(value: unknown, path: string, issues: RunLaunchIssue[]) {
	if (typeof value === "string" && value.trim().length > 0) {
		return value;
	}

	issues.push(
		createRunLaunchIssue(
			"invalid_shape",
			path,
			`${path} must be a non-empty string.`,
		),
	);
	return "";
}

function readRepoBindings(value: unknown, issues: RunLaunchIssue[]) {
	if (!isObject(value) || Array.isArray(value)) {
		issues.push(
			createRunLaunchIssue(
				"invalid_shape",
				"$.repoBindings",
				"$.repoBindings must be an object whose keys are repo ids and values are absolute paths.",
			),
		);
		return {};
	}

	const repoBindings: Record<string, string> = {};
	for (const repoId of Object.keys(value).sort()) {
		const bindingPath = value[repoId];
		if (typeof bindingPath !== "string" || bindingPath.trim().length === 0) {
			issues.push(
				createRunLaunchIssue(
					"invalid_shape",
					`$.repoBindings.${repoId}`,
					`$.repoBindings.${repoId} must be a non-empty string.`,
				),
			);
			continue;
		}
		repoBindings[repoId] = bindingPath;
	}

	return repoBindings;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}
