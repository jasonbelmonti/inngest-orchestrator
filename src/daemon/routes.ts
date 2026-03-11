import { DaemonHttpError, toDaemonHttpError } from "./errors.ts";
import {
	handleCreateRun,
	handleListRuns,
	handleReadRun,
	handleRunControl,
	type DaemonHandlerOptions,
} from "./handlers.ts";
import { matchDaemonRoute } from "./route-matching.ts";
import { errorResponse, successResponse } from "./responses.ts";

export function createDaemonFetchHandler(options: DaemonHandlerOptions) {
	return async function fetch(request: Request) {
		const route = matchDaemonRoute(new URL(request.url).pathname);

		try {
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
					...(route.kind === "run-detail" || route.kind === "run-control"
						? { runId: route.runId }
						: {}),
				}),
			);
		}
	};
}
