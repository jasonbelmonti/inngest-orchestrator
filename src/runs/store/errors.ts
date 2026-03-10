export type RunStoreErrorCode =
	| "run_store_not_found"
	| "run_store_conflict"
	| "run_store_invalid_transition";

export class RunStoreError extends Error {
	readonly code: RunStoreErrorCode;

	constructor(input: { code: RunStoreErrorCode; message: string; cause?: unknown }) {
		super(input.message);
		this.name = "RunStoreError";
		this.code = input.code;
		if (input.cause !== undefined) {
			this.cause = input.cause;
		}
	}
}
