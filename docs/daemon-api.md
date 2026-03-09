# Daemon API Contract

## Run Launch

`BEL-341` defines the normalized launch payload consumed by the future local daemon `POST /runs`
route.

Request envelope:

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

Rules:

- `workflowId` must be a non-empty string.
- `configRoot` must be a non-empty string.
- `repoBindings` must be an object whose keys are workflow repo ids and whose values are absolute
  local directory paths.
- required workflow repo ids must be present in `repoBindings`
- unknown repo ids fail closed
- optional declared repos may be omitted and are normalized as `unbound_optional`

Normalized resolved payload:

```json
{
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
    },
    {
      "repoId": "inngest-orchestrator",
      "label": "Inngest Orchestrator",
      "required": false,
      "status": "unbound_optional",
      "resolvedPath": null
    }
  ]
}
```

Determinism guarantees:

- `repoBindings` are normalized in workflow declaration order, not caller object-key order
- equivalent input payloads produce equivalent normalized resolved payloads
- resolution errors use stable machine-readable codes before any persistence begins

Current machine-readable error codes:

- `invalid_run_launch_input`
- `repo_binding_resolution_failed`

Current issue codes:

- `invalid_shape`
- `config_root_invalid`
- `workflow_not_found`
- `missing_required_repo_binding`
- `unknown_repo_binding`
- `invalid_repo_binding_path`
- `repo_binding_path_not_absolute`
- `repo_binding_path_not_found`
- `repo_binding_path_not_directory`
