import type { RunEventInput } from "../runs/store/types.ts";
import type { RunControlRequest } from "./types.ts";

export function toRunControlEvent(
	control: RunControlRequest,
	occurredAt: string,
): RunEventInput {
	switch (control.action) {
		case "cancel":
			return {
				type: "run.cancelled",
				occurredAt,
				...(control.reason !== undefined ? { reason: control.reason } : {}),
			};
		case "request_approval":
			return {
				type: "approval.requested",
				occurredAt,
				approvalId: control.approvalId,
				stepId: control.stepId,
				...(control.message !== undefined ? { message: control.message } : {}),
			};
		case "resolve_approval":
			return {
				type: "approval.resolved",
				occurredAt,
				approvalId: control.approvalId,
				decision: control.decision,
				...(control.comment !== undefined ? { comment: control.comment } : {}),
			};
	}
}
