# Daemon API Contract

`BEL-343` adds the first runnable local daemon surface for persisted run launch, query, and control.

## Startup

Run the daemon directly with Bun:

```bash
bun ./src/daemon.ts
```

Default runtime settings:

- host: `127.0.0.1`
- port: `3017`
- database path: `<repo>/.local/inngest-orchestrator.sqlite`

Optional environment overrides:

- `INNGEST_ORCHESTRATOR_HOST` for loopback-only hosts (`127.0.0.1`, `localhost`, or `::1`)
- `INNGEST_ORCHESTRATOR_PORT`
- `INNGEST_ORCHESTRATOR_DB_PATH`

This slice is local-only. It does not add authentication or remote bind behavior.

## Response Envelopes

Success:

```json
{
  "ok": true
}
```

Error:

```json
{
  "ok": false,
  "error": {
    "code": "invalid_http_input",
    "message": "Request body must be a JSON object."
  }
}
```

Error notes:

- malformed JSON request bodies return `400` with `code: "invalid_json_body"`
- invalid HTTP request shapes return `400` with `code: "invalid_http_input"`
- `RunLaunchError` responses keep their existing `code` and `issues`
- `run_store_not_found` returns `404`
- `run_store_conflict` and `run_store_invalid_transition` return `409`
- unexpected errors return `500` with `code: "internal_error"`

## POST /runs

Creates a run from the existing launch contract, persists it, then immediately appends
`run.started`.

Request body:

```json
{
  "workflowId": "cross-repo-bugfix",
  "configRoot": "/Users/example/agent-cockpit-workflows",
  "repoBindings": {
    "agent-console": "/Users/example/Development/agent-console",
    "inngest-orchestrator": "/Users/example/Development/inngest-orchestrator"
  }
}
```

Success status: `201`

Success response:

```json
{
  "ok": true,
  "run": {
    "runId": "9ab0c83f-d1e1-4618-b3e1-2094f9dd5fc0",
    "status": "running",
    "currentStepId": null,
    "latestEventSequence": 2,
    "createdAt": "2026-03-11T12:00:00.000Z",
    "updatedAt": "2026-03-11T12:00:00.000Z",
    "launch": {
      "configRoot": "/Users/example/agent-cockpit-workflows",
      "workflow": {
        "workflowId": "cross-repo-bugfix",
        "name": "Cross-Repo Bugfix",
        "summary": "Example workflow",
        "contentHash": "<sha256>",
        "filePath": "/Users/example/agent-cockpit-workflows/workflows/cross-repo-bugfix.json"
      },
      "repoBindings": [
        {
          "repoId": "agent-console",
          "label": "Agent Console",
          "required": true,
          "status": "resolved",
          "resolvedPath": "/Users/example/Development/agent-console"
        }
      ]
    },
    "approvals": [],
    "artifacts": []
  }
}
```

## GET /runs

Returns persisted run summaries from SQLite.

Success status: `200`

Success response:

```json
{
  "ok": true,
  "runs": [
    {
      "runId": "9ab0c83f-d1e1-4618-b3e1-2094f9dd5fc0",
      "workflowId": "cross-repo-bugfix",
      "workflowName": "Cross-Repo Bugfix",
      "status": "running",
      "currentStepId": null,
      "createdAt": "2026-03-11T12:00:00.000Z",
      "updatedAt": "2026-03-11T12:00:00.000Z",
      "latestEventSequence": 2
    }
  ]
}
```

## GET /runs/:id

Returns the full persisted `RunProjectionRecord` for one run.

Success status: `200`

Unknown runs return `404` with `code: "run_store_not_found"`.

## POST /runs/:id/control

Applies one control action to a persisted run.

Success status: `200`

Supported request shapes:

```json
{ "action": "cancel", "reason": "operator stopped run" }
```

```json
{
  "action": "request_approval",
  "approvalId": "approval-001",
  "stepId": "implement",
  "message": "Ship it?"
}
```

```json
{
  "action": "resolve_approval",
  "approvalId": "approval-001",
  "decision": "approved",
  "comment": "Looks good."
}
```

Action mapping:

- `cancel` -> append `run.cancelled`
- `request_approval` -> append `approval.requested`
- `resolve_approval` -> append `approval.resolved`

Validation notes:

- the daemon does not invent `approvalId` or `stepId`
- the daemon does not add synthetic `step.started` or `step.completed` helpers
- `request_approval` succeeds only when the run is already on an active step
- state transition validation remains owned by the run store

## Status Codes

- `200` successful read or control mutation
- `201` successful run creation
- `400` malformed JSON or invalid request body
- `404` unknown route or unknown run id
- `405` wrong HTTP method for a known route
- `409` invalid run-store transition or conflict
- `500` unexpected internal error

## Current Scope Boundary

`BEL-343` is durable HTTP state only.

Not included yet:

- no SSE stream on `GET /runs/:id/events`
- no Inngest workflow execution
- no managed provider sessions

Those arrive in later slices.
