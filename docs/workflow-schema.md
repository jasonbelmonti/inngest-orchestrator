# Workflow Schema

## Config Root

The orchestrator is config-root driven. The minimum supported layout for this slice is:

```txt
<config-root>/
  repos/
    workspace.repos.json
  workflows/
    *.json
```

Recommended default:

- use a dedicated workflow repo as the config root for cross-project orchestration
- keep local machine repo bindings out of git

## Repository Catalog

`repos/workspace.repos.json` declares the logical repositories the workflow root knows about.

```json
{
  "schemaVersion": 1,
  "repositories": [
    { "id": "agent-console", "label": "Agent Console" }
  ]
}
```

Workflows may only reference repository ids that exist in this catalog.

## Workflow Document

Every workflow document is a JSON file under `workflows/` with this canonical shape:

```ts
interface WorkflowDocument {
  schemaVersion: 1;
  workflowId: string;
  name: string;
  summary?: string;
  repositories: Array<{
    id: string;
    required: boolean;
    label?: string;
  }>;
  phases: Array<{
    id: string;
    label: string;
    order: number;
  }>;
  nodes: Array<{
    id: string;
    kind: "trigger" | "task" | "check" | "gate" | "artifact" | "terminal";
    label: string;
    phaseId: string;
    description?: string;
    station?: string;
    target?: {
      repoId: string;
      worktreeStrategy?: "shared" | "ephemeral";
    };
    settings: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    sourceId: string;
    targetId: string;
    condition: "always" | "on_success" | "on_failure" | "on_approval";
  }>;
}
```

## Validation Rules

This slice enforces:

- deterministic canonical JSON serialization and content hashing
- duplicate id rejection for repositories, phases, nodes, edges, and workflow ids across files
- missing phase and node reference rejection
- repo-target requirements for `task`, `check`, and `artifact` nodes
- repo references must exist in the config-root catalog and be declared in the workflow

## Compiler Boundary

The persisted workflow document can exist independently from the executable subset. The compiler
currently accepts only these template values in `node.settings.template`:

- `trigger.manual`
- `task.agent`
- `gate.approval`
- `check.shell`
- `artifact.capture`
- `terminal.complete`

Any other template is rejected by the executable compiler boundary with a machine-readable error.
