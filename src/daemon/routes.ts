import { DaemonHttpError, toDaemonHttpError } from "./errors.ts";
import {
	handleCreateRun,
	handleListRuns,
	handleReadRun,
	handleRunControl,
	handleRunEvents,
	type DaemonHandlerOptions,
} from "./handlers.ts";
import { matchDaemonRoute } from "./route-matching.ts";
import { errorResponse } from "./responses.ts";

export function createDaemonFetchHandler(options: DaemonHandlerOptions) {
	return async function fetch(request: Request) {
		const pathname = new URL(request.url).pathname;

		try {
			const route = matchDaemonRoute(pathname);
			switch (route.kind) {
				case "runs":
					if (request.method === "GET") {
						return handleListRuns(options.store);
					}
					if (request.method === "POST") {
						return await handleCreateRun(request, options);
					}
					throw new DaemonHttpError({
						status: 405,
						code: "method_not_allowed",
						message: `Method "${request.method}" is not allowed for "/runs".`,
					});
				case "inngest-handler":
					return await options.inngestHandler(request);
				case "run-detail":
					if (request.method !== "GET") {
						throw new DaemonHttpError({
							status: 405,
							code: "method_not_allowed",
							message: `Method "${request.method}" is not allowed for "/runs/:id".`,
						});
					}
					return handleReadRun(route.runId, options.store);
				case "run-control":
					if (request.method !== "POST") {
						throw new DaemonHttpError({
							status: 405,
							code: "method_not_allowed",
							message: `Method "${request.method}" is not allowed for "/runs/:id/control".`,
							runId: route.runId,
						});
					}
					return await handleRunControl(request, route.runId, options);
				case "run-events":
					if (request.method !== "GET") {
						throw new DaemonHttpError({
							status: 405,
							code: "method_not_allowed",
							message: `Method "${request.method}" is not allowed for "/runs/:id/events".`,
							runId: route.runId,
						});
					}
					return handleRunEvents(
						route.runId,
						options.store,
						options.eventStreamBroker,
						request,
					);
				case "not-found":
					throw new DaemonHttpError({
						status: 404,
						code: "route_not_found",
						message: `Route "${route.pathname}" was not found.`,
					});
			}
		} catch (error) {
			return errorResponse(
				toDaemonHttpError(error, {
					...(deriveRunIdFromPath(pathname)
						? { runId: deriveRunIdFromPath(pathname) }
						: {}),
				}),
			);
		}
	};
}

function deriveRunIdFromPath(pathname: string) {
	try {
		const route = matchDaemonRoute(pathname);
		return route.kind === "run-detail" ||
			route.kind === "run-control" ||
			route.kind === "run-events"
			? route.runId
			: undefined;
	} catch {
		return undefined;
	}
}
