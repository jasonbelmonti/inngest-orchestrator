# Run Store Contract

`BEL-342` adds the machine-local SQLite persistence layer for run state.

## Scope

The run store persists:

- append-only run events
- current run projections
- approval request state
- artifact records
- replay cursor state per run

Workflow definitions remain config-root-backed files. SQLite stores operational state only.

## Store API

Current public entrypoint:

- `SQLiteRunStore.open({ databasePath? })`

Current operations:

- `createRun({ runId, createdAt, launch })`
- `appendEvent({ runId, event })`
- `readRun(runId)`
- `listRuns()`
- `listEvents(runId)`
- `readCursor(runId)`
- `saveCursor({ runId, lastEventSequence, updatedAt })`
- `rebuildProjections()`
- `close()`

## Event Model

Persisted events currently support:

- `run.created`
- `run.started`
- `step.started`
- `step.completed`
- `step.failed`
- `approval.requested`
- `approval.resolved`
- `artifact.created`
- `run.completed`
- `run.failed`
- `run.cancelled`

## Derived Projection Rules

- runs start in `created`
- `run.started` moves a run to `running`
- `approval.requested` moves a run to `waiting_for_approval`
- `approval.resolved` moves a run back to `running`
- `run.completed`, `run.failed`, and `run.cancelled` are terminal
- invalid transitions fail closed with machine-readable `RunStoreError.code` values

## Rebuild Behavior

Opening the store rebuilds derived tables from `run_events`.

This keeps projections deterministic and makes restart recovery simple for the future daemon layer.

Replay cursors are stored separately from derived projections and are not overwritten during
projection rebuilds.
