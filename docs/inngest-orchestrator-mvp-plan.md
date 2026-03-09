# Inngest Orchestrator MVP Plan

## Summary

Build `inngest-orchestrator` as a Bun-hosted local control plane on top of Inngest functions for
durable steps, retries, waits, and concurrency.

This repo should own:

- workflow schema, compiler rules, and validation
- config-root loading and workflow discovery
- workflow validation, hashing, and persistence
- a local runtime daemon for launching and controlling managed runs
- durable execution orchestration using Inngest
- sample fixtures and example workflows for testing and docs

This repo should not own:

- the only authoritative home for real workflows
- the workflow-builder UI
- React Flow rendering concerns
- direct sibling-import runtime coupling into `agent-console`

The default operating model should be:

- `inngest-orchestrator` provides the schema, loader, CLI, daemon, and runtime
- a configurable workflow root supplies actual workflows and shared config
- a dedicated workflow repo is the recommended workflow root for cross-project orchestration
- local machine bindings resolve logical repo ids to actual filesystem paths at run time

`agent-console` remains a consumer through CLI and daemon contracts.

## Locked Decisions

- Use app-launched managed sessions only in v1.
- Treat a managed agent instance as a durable provider session abstraction, not a raw PID-first
  process supervisor.
- Keep a provider-neutral runner seam in this repo so `claudex` can slot in later without changing
  orchestrator contracts.
- Make the orchestrator config-root driven rather than repo-coupled.
- Recommend a dedicated workflow repo for cross-project workflows, but do not hard-require it.
- Treat workflow definitions as portable documents that reference logical repo ids, not absolute
  local paths.
- Use JSON CLI commands for workflow authoring operations.
- Use a local daemon boundary for live runtime launch, control, and event streaming.
- Keep live run state machine-local in v1; portability across laptops is definition-sync via git,
  not cross-device runtime continuity.
- Support two executable step classes in v1:
  - durable agent steps
  - deterministic shell-check steps

## Architecture

### Boundaries

- `agent-console`
  - workflow-builder UI
  - list/read/validate/save workflow authoring through JSON CLI
  - run visibility and live control through daemon APIs
- `inngest-orchestrator`
  - workflow schema and compiler
  - config-root loading, file persistence, and validation
  - run daemon and local SQLite projections
  - Inngest workflows and executor dispatch
- workflow root
  - real workflow definitions
  - repo catalog and shared templates
  - recommended as a dedicated git repo for cross-project orchestration
- `claudex`
  - future implementation of the provider-neutral runner seam

### Configuration model

The runtime should load workflows from a configurable root rather than assuming they live inside
the orchestrator implementation repo.

Recommended resolution model:

- config root:
  - passed via CLI flag such as `--config-root`
  - or environment such as `AGENT_ORCHESTRATOR_CONFIG_ROOT`
- logical repo catalog:
  - defined in the config root
  - names repos like `agent-console`, `claudex`, `inngest-orchestrator`
- machine-local bindings:
  - map logical repo ids to absolute local paths
  - supplied by local config, daemon settings, or run launch payloads

Recommended default:

- keep cross-project workflows in a dedicated workflow repo
- allow future support for multiple workflow roots or per-project overlays

### Runtime surfaces

Workflow authoring CLI:

- `workflow list --config-root <path>`
- `workflow read <id> --config-root <path>`
- `workflow validate --stdin --config-root <path>`
- `workflow save --stdin --config-root <path>`

Local daemon API:

- `POST /runs`
- `GET /runs`
- `GET /runs/:id`
- `POST /runs/:id/control`
- `GET /runs/:id/events` via SSE

### Local persistence

Persist machine-local operational state for:

- managed sessions
- run projections
- resolved repo bindings for active runs
- approval requests
- artifacts
- daemon event cursors or replayable run events

Workflow definitions remain config-root-backed files and should not be duplicated into SQLite as a
source of truth.

## Workflow Model

Persist the canonical DAG document shape already planned for `agent-console`, but execute only a
constrained template-first subset in v1.

Add two portability-oriented concepts to the document model:

- top-level repository declarations using logical repo ids
- per-node execution targets that point at a logical repo id rather than a raw local path

The workflow document should be able to express a cross-project orchestration while remaining
portable across machines.

Illustrative additions:

```ts
interface WorkflowRepositoryBinding {
  id: string;
  label: string;
  required: boolean;
}

interface WorkflowExecutionTarget {
  repoId: string;
  worktreeStrategy?: "shared" | "ephemeral";
}
```

Supported node kinds:

- `trigger`
- `task`
- `check`
- `gate`
- `artifact`
- `terminal`

Supported edge conditions:

- `always`
- `on_success`
- `on_failure`
- `on_approval`

Supported executable templates:

- `trigger.manual`
- `task.agent`
- `gate.approval`
- `check.shell`
- `artifact.capture`
- `terminal.complete`

Unsupported graph features in v1:

- arbitrary custom node kinds
- persisted canvas coordinates
- fan-out and merge execution
- generic graph interpretation of every possible node combination
- adoption of externally discovered sessions into orchestrated ownership

## First End-to-End Workflow

The first workflow this MVP must prove is:

`manual trigger -> agent task -> optional approval gate -> shell check -> terminal`

Execution rules:

- Compile the config-root workflow document into a constrained single-path execution plan before
  dispatching it to Inngest.
- Resolve logical repo ids to machine-local paths before run start and fail closed if required repo
  bindings are missing.
- Unsupported graph shapes fail validation instead of being partially interpreted at runtime.
- Agent steps start or resume an app-managed Claude/Codex session tied to `runId`, `provider`, and
  a primary repo target.
- Agent steps default to `attempts: 1` unless a workflow explicitly opts into a retry policy.
- Shell checks execute against the step's targeted repo and use normal Inngest retry and backoff
  behavior for transient failures.
- Approval gates pause with an event wait and resume only from explicit console or CLI approval,
  reply, or cancel actions.
- Concurrency should be capped per machine or workspace using Inngest concurrency keys.

## Public Contracts

### Internal runner seam

The orchestrator should target an internal provider-neutral runner interface that supports:

- `checkReadiness()`
- `createManagedSession()`
- `resumeManagedSession()`
- `runTurn()`
- `cancel()`
- `getSessionRef()`

### Streamed daemon event envelope

Expose normalized run events such as:

- `run.started`
- `step.started`
- `step.updated`
- `approval.requested`
- `agent.message`
- `artifact.created`
- `run.completed`
- `run.failed`
- `run.cancelled`

### Run launch contract

Run launch needs to bind workflow portability to machine-local execution. A run request should
carry:

- `workflowId`
- `configRoot`
- `repoBindings`
- `provider`
- workflow parameters or launch metadata

The daemon should reject launches when required logical repos cannot be resolved.

## Execution Breakdown

Use the internal `IO-*` slice names below in planning docs. Linear can assign fresh issue
identifiers in the new project without reusing any older project namespace.

Parent slice:

- `IO-00` Inngest orchestrator MVP

Child execution slices:

1. `IO-01` Canonical workflow schema, logical repo bindings, and config-root storage contract
2. `IO-02` Config-root workflow CLI JSON bridge and optimistic save semantics
3. `IO-03` Local daemon API, repo resolution, SQLite run projections, and streamed event transport
4. `IO-04` Inngest runtime for manual trigger, approval gate, repo-targeted shell checks, and terminal flow
5. `IO-05` Managed agent runner seam and repo-targeted provider session integration
6. `IO-06` Agent Console runtime bridge for config-root workflow loading, launch, status, and control
7. `IO-07` Acceptance coverage, config-root smoke flows, and implementation docs

Dependency chain:

- `IO-01 -> IO-02`
- `IO-01 -> IO-04`
- `IO-03 -> IO-04`
- `IO-03 -> IO-05`
- `IO-02 + IO-03 -> IO-06`
- `IO-04 + IO-05 + IO-06 -> IO-07`

Parallelism notes:

- `IO-02` and `IO-03` can proceed in parallel once `IO-01` lands.
- `IO-04` and `IO-05` can proceed in parallel once `IO-03` lands, but both should consume the
  same run and event contracts.

## Acceptance Snapshot

This MVP is complete when all of the following are true:

- `agent-console` can load workflows from a configured workflow root through the CLI JSON commands.
- A user can launch a workflow run through the daemon and observe live streamed status updates.
- The first supported workflow can pause for approval, resume, run a shell check, and terminate
  with persisted artifacts and run status.
- A run fails closed when required logical repo bindings cannot be resolved on the local machine.
- One Claude managed run and one Codex managed run both complete the supported flow locally.
- Workflow save operations fail closed on optimistic concurrency conflicts.
- The integrated changes pass repository tests and documented smoke validation.
