import {
	REPO_TARGET_NODE_KINDS,
	SUPPORTED_WORKFLOW_EDGE_CONDITIONS,
	SUPPORTED_WORKFLOW_NODE_KINDS,
	SUPPORTED_WORKTREE_STRATEGIES,
} from "../constants.ts";
import { createIssue, type WorkflowValidationIssue } from "../errors.ts";
import type {
	JsonObject,
	WorkflowEdgeCondition,
	WorkflowNodeKind,
	WorkflowWorktreeStrategy,
} from "../types.ts";

type RepoTargetNodeKind = (typeof REPO_TARGET_NODE_KINDS)[number];

export function asObject(
	value: unknown,
	path: string,
	issues: WorkflowValidationIssue[],
): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		issues.push(
			createIssue("invalid_shape", path, `${path} must be an object.`),
		);
		return null;
	}
	return value as Record<string, unknown>;
}

export function asJsonObject(
	value: unknown,
	path: string,
	issues: WorkflowValidationIssue[],
): JsonObject | null {
	const objectValue = asObject(value, path, issues);
	if (!objectValue) {
		return null;
	}
	return objectValue as JsonObject;
}

export function asNonEmptyString(
	value: unknown,
	path: string,
	issues: WorkflowValidationIssue[],
): string | null {
	if (typeof value !== "string" || value.trim().length === 0) {
		issues.push(
			createIssue("invalid_shape", path, `${path} must be a non-empty string.`),
		);
		return null;
	}
	return value;
}

export function asOptionalString(
	value: unknown,
	path: string,
	issues: WorkflowValidationIssue[],
): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "string") {
		issues.push(
			createIssue(
				"invalid_shape",
				path,
				`${path} must be a string when provided.`,
			),
		);
		return undefined;
	}
	return value;
}

export function asBoolean(
	value: unknown,
	path: string,
	issues: WorkflowValidationIssue[],
): boolean | null {
	if (typeof value !== "boolean") {
		issues.push(
			createIssue("invalid_shape", path, `${path} must be a boolean.`),
		);
		return null;
	}
	return value;
}

export function asFiniteNumber(
	value: unknown,
	path: string,
	issues: WorkflowValidationIssue[],
): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		issues.push(
			createIssue("invalid_shape", path, `${path} must be a finite number.`),
		);
		return null;
	}
	return value;
}

export function asWorkflowNodeKind(
	value: unknown,
	path: string,
	issues: WorkflowValidationIssue[],
): WorkflowNodeKind | null {
	if (
		typeof value !== "string" ||
		!SUPPORTED_WORKFLOW_NODE_KINDS.includes(value as WorkflowNodeKind)
	) {
		issues.push(
			createIssue(
				"invalid_shape",
				path,
				`${path} must be one of ${SUPPORTED_WORKFLOW_NODE_KINDS.join(", ")}.`,
			),
		);
		return null;
	}
	return value as WorkflowNodeKind;
}

export function asWorkflowEdgeCondition(
	value: unknown,
	path: string,
	issues: WorkflowValidationIssue[],
): WorkflowEdgeCondition | null {
	if (
		typeof value !== "string" ||
		!SUPPORTED_WORKFLOW_EDGE_CONDITIONS.includes(value as WorkflowEdgeCondition)
	) {
		issues.push(
			createIssue(
				"invalid_shape",
				path,
				`${path} must be one of ${SUPPORTED_WORKFLOW_EDGE_CONDITIONS.join(", ")}.`,
			),
		);
		return null;
	}
	return value as WorkflowEdgeCondition;
}

export function asOptionalWorktreeStrategy(
	value: unknown,
	path: string,
	issues: WorkflowValidationIssue[],
): WorkflowWorktreeStrategy | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (
		typeof value !== "string" ||
		!SUPPORTED_WORKTREE_STRATEGIES.includes(value as WorkflowWorktreeStrategy)
	) {
		issues.push(
			createIssue(
				"invalid_shape",
				path,
				`${path} must be one of ${SUPPORTED_WORKTREE_STRATEGIES.join(", ")} when provided.`,
			),
		);
		return undefined;
	}

	return value as WorkflowWorktreeStrategy;
}

export function appendDuplicateIdIssues<T extends { id: string }>(input: {
	entries: T[];
	pathPrefix: string;
	issueCode:
		| "duplicate_repository_id"
		| "duplicate_phase_id"
		| "duplicate_node_id"
		| "duplicate_edge_id";
	issues: WorkflowValidationIssue[];
}) {
	const seen = new Set<string>();
	for (const [index, entry] of input.entries.entries()) {
		if (seen.has(entry.id)) {
			input.issues.push(
				createIssue(
					input.issueCode,
					`${input.pathPrefix}[${index}].id`,
					`Duplicate id "${entry.id}" is not allowed.`,
				),
			);
			continue;
		}
		seen.add(entry.id);
	}
}

export function pushInvalidShape(
	issues: WorkflowValidationIssue[],
	path: string,
	message: string,
) {
	issues.push(createIssue("invalid_shape", path, message));
	return null;
}

export function requiresRepoTarget(
	kind: WorkflowNodeKind,
): kind is RepoTargetNodeKind {
	return REPO_TARGET_NODE_KINDS.includes(kind as RepoTargetNodeKind);
}
