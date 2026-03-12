import { EventSchemas, Inngest } from "inngest";

export const RUNTIME_DISPATCH_EVENT = "orchestrator/run.requested";

export interface RuntimeDispatchEventData {
	runId: string;
}

export const inngest = new Inngest({
	id: "inngest-orchestrator",
	schemas: new EventSchemas().fromRecord<{
		[RUNTIME_DISPATCH_EVENT]: {
			data: RuntimeDispatchEventData;
		};
	}>(),
});

export function dispatchPersistedRun(input: {
	client?: Pick<typeof inngest, "send">;
	runId: string;
}) {
	const client = input.client ?? inngest;
	return client.send({
		name: RUNTIME_DISPATCH_EVENT,
		data: {
			runId: input.runId,
		},
	});
}
