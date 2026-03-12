import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveRunLaunchRequest } from "../runs/repo-bindings.ts";
import { SQLiteRunStore } from "../runs/store/sqlite-store.ts";
import { serializeWorkflowRepositoryCatalog } from "../workflows/serialization.ts";
import {
	makeRepositoryCatalog,
	makeWorkflow,
} from "../workflows/test-fixtures.ts";
import { createDaemonApp } from "./app.ts";
import { RunEventStreamBroker } from "./sse.ts";
import type { DaemonRequestHandler, RuntimeDispatchFunction } from "./types.ts";

const tempDirectories: string[] = [];
const openStores: SQLiteRunStore[] = [];

export interface DaemonTestHarness {
	configRoot: string;
	databasePath: string;
	repoBindings: {
		"agent-console": string;
		"inngest-orchestrator": string;
	};
	store: SQLiteRunStore;
	eventStreamBroker: RunEventStreamBroker;
	app: ReturnType<typeof createDaemonApp>;
}

interface CreateDaemonTestHarnessOptions {
	dispatchRun?: RuntimeDispatchFunction;
	inngestHandler?: DaemonRequestHandler;
	useAppDefaultDispatch?: boolean;
}

export async function cleanupDaemonTestHarnesses() {
	for (const store of openStores.splice(0)) {
		store.close();
	}

	await Promise.all(
		tempDirectories.map((directory) =>
			rm(directory, { recursive: true, force: true }),
		),
	);
	tempDirectories.length = 0;
}

export async function dispatchDaemonRequest(
	app: ReturnType<typeof createDaemonApp>,
	method: string,
	pathname: string,
	body?: unknown,
) {
	return app.fetch(
		new Request(`http://daemon.test${pathname}`, {
			method,
			headers:
				body === undefined ? undefined : { "content-type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
	);
}

export async function readDaemonJson(response: Response) {
	return response.json();
}

export async function createDaemonTestHarness(
	options: CreateDaemonTestHarnessOptions = {},
) {
	const root = await mkdtemp(join(tmpdir(), "inngest-orchestrator-daemon-"));
	tempDirectories.push(root);

	const configRoot = join(root, "config-root");
	const reposDirectory = join(configRoot, "repos");
	const workflowsDirectory = join(configRoot, "workflows");
	const agentConsolePath = join(root, "agent-console");
	const orchestratorPath = join(root, "inngest-orchestrator");
	const databasePath = join(root, "runs.sqlite");

	await mkdir(reposDirectory, { recursive: true });
	await mkdir(workflowsDirectory, { recursive: true });
	await mkdir(agentConsolePath, { recursive: true });
	await mkdir(orchestratorPath, { recursive: true });

	await Bun.write(
		join(reposDirectory, "workspace.repos.json"),
		serializeWorkflowRepositoryCatalog(makeRepositoryCatalog()),
	);
	await Bun.write(
		join(workflowsDirectory, "cross-repo-bugfix.json"),
		`${JSON.stringify(makeWorkflow(), null, 2)}\n`,
	);

	const store = SQLiteRunStore.open({ databasePath });
	openStores.push(store);
	const eventStreamBroker = new RunEventStreamBroker({ keepAliveMs: 60_000 });

	return {
		configRoot,
		databasePath,
		repoBindings: {
			"agent-console": agentConsolePath,
			"inngest-orchestrator": orchestratorPath,
		},
		store,
		eventStreamBroker,
		app: createDaemonApp({
			store,
			eventStreamBroker,
			generateRunId: makeSequentialRunIdGenerator(),
			now: () => "2026-03-11T12:00:00.000Z",
			...(options.useAppDefaultDispatch
				? {}
				: {
						dispatchRun: options.dispatchRun ?? (() => Promise.resolve()),
					}),
			inngestHandler:
				options.inngestHandler ??
				(() =>
					new Response("ok", {
						status: 200,
					})),
		}),
	} satisfies DaemonTestHarness;
}

export async function reopenDaemonTestHarness(
	harness: DaemonTestHarness,
	options?: {
		now?: () => string;
		dispatchRun?: RuntimeDispatchFunction;
		inngestHandler?: DaemonRequestHandler;
		useAppDefaultDispatch?: boolean;
	},
) {
	harness.store.close();
	detachOpenStore(harness.store);

	const reopenedStore = SQLiteRunStore.open({
		databasePath: harness.databasePath,
	});
	attachOpenStore(reopenedStore);
	const eventStreamBroker = new RunEventStreamBroker({ keepAliveMs: 60_000 });

	return {
		configRoot: harness.configRoot,
		databasePath: harness.databasePath,
		repoBindings: harness.repoBindings,
		store: reopenedStore,
		eventStreamBroker,
		app: createDaemonApp({
			store: reopenedStore,
			eventStreamBroker,
			generateRunId: makeSequentialRunIdGenerator(),
			now: options?.now ?? (() => "2026-03-11T12:10:00.000Z"),
			...(options?.useAppDefaultDispatch
				? {}
				: {
						dispatchRun: options?.dispatchRun ?? (() => Promise.resolve()),
					}),
			inngestHandler:
				options?.inngestHandler ??
				(() =>
					new Response("ok", {
						status: 200,
					})),
		}),
	} satisfies DaemonTestHarness;
}

export async function seedActiveStepRun(
	input: DaemonTestHarness,
	runId: string,
) {
	const launch = await resolveRunLaunchRequest({
		workflowId: "cross-repo-bugfix",
		configRoot: input.configRoot,
		repoBindings: input.repoBindings,
	});

	input.store.createRun({
		runId,
		createdAt: "2026-03-11T12:01:00.000Z",
		launch,
	});
	input.store.appendEvent({
		runId,
		event: {
			type: "run.started",
			occurredAt: "2026-03-11T12:01:01.000Z",
		},
	});
	input.store.appendEvent({
		runId,
		event: {
			type: "step.started",
			occurredAt: "2026-03-11T12:01:02.000Z",
			stepId: "implement",
		},
	});
}

export function detachOpenStore(store: SQLiteRunStore) {
	const index = openStores.indexOf(store);
	if (index >= 0) {
		openStores.splice(index, 1);
	}
}

export function attachOpenStore(store: SQLiteRunStore) {
	openStores.push(store);
}

function makeSequentialRunIdGenerator() {
	let counter = 0;

	return () => {
		counter += 1;
		return `run-${counter.toString().padStart(3, "0")}`;
	};
}
