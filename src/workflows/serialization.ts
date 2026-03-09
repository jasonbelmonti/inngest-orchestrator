import { createHash } from "node:crypto";
import type {
	JsonObject,
	JsonValue,
	WorkflowDocument,
	WorkflowRepositoryCatalog,
} from "./types.ts";

export function serializeWorkflowDocument(document: WorkflowDocument): string {
	return `${stableStringify(document)}\n`;
}

export function serializeWorkflowRepositoryCatalog(
	catalog: WorkflowRepositoryCatalog,
): string {
	return `${stableStringify(catalog)}\n`;
}

export function hashWorkflowDocument(document: WorkflowDocument): string {
	return createHash("sha256")
		.update(serializeWorkflowDocument(document))
		.digest("hex");
}

function stableStringify(value: JsonValue | WorkflowDocument | WorkflowRepositoryCatalog) {
	return JSON.stringify(sortJsonValue(value), null, 2);
}

function sortJsonValue(value: JsonValue | WorkflowDocument | WorkflowRepositoryCatalog): JsonValue {
	if (Array.isArray(value)) {
		return value.map((entry) => sortJsonValue(entry));
	}

	if (value !== null && typeof value === "object") {
		const sortedEntries = Object.entries(value as JsonObject)
			.filter(([, entryValue]) => entryValue !== undefined)
			.sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
			.map(([key, entryValue]) => [key, sortJsonValue(entryValue)] as const);
		return Object.fromEntries(sortedEntries);
	}

	return value;
}
