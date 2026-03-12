# Runtime Flow Contract

## BEL-373 persisted run dispatch

BEL-373 introduces the first runtime dispatch event consumed by the Inngest-backed worker:

```ts
interface RuntimeDispatchEvent {
  name: "orchestrator/run.requested";
  data: {
    runId: string;
  };
}
```

The same daemon process mounts the Inngest handler at `/api/inngest`, but the stock BEL-373
`POST /runs` path uses in-process dispatch by default so local execution does not depend on an
external Inngest event key. The explicit `orchestrator/run.requested` event contract remains the
durable worker contract for later daemon/runtime bridge slices.

The runtime worker loads the persisted run from SQLite, re-reads the workflow from the launch
config root, recompiles the BEL-366 execution plan against the pinned workflow snapshot, and
applies all durable state changes through the run store.

In BEL-373, the executor does not attempt mid-run resume. If a run is already partially advanced
and still marked `running`, the executor fails it closed rather than guessing how to continue.

## BEL-372 shell-check subset

`check.shell` executes as a deterministic local shell command against the resolved repo target for
the runtime step. The executor does not use the daemon process cwd.

### Execution behavior

- shell command shell: `/bin/sh -lc <command>`
- working directory: `step.target.resolvedPath`
- success condition: exit code `0`
- failure condition: any non-zero exit code

Both successful and non-zero exits return a structured result payload. Non-zero exits are reported
as `status: "failed"` but still persist an artifact file for later run-store mapping.

### Artifact path convention

Shell-check artifacts are stored under the targeted repo using a deterministic repo-relative path:

```txt
.inngest-orchestrator/artifacts/runs/<encoded-runId>/steps/<encoded-stepId>/shell-check.json
```

`runId` and `stepId` are path-safe encoded before they are inserted into the artifact path, so
traversal-shaped ids cannot escape the targeted repo root.

### Result payload

```ts
interface RuntimeShellCheckResult {
  stepId: string;
  repoId: string;
  command: string;
  exitCode: number;
  status: "completed" | "failed";
  artifact: {
    kind: "shell-check-report";
    repoId: string;
    relativePath: string;
    metadata: {
      schemaVersion: 1;
      command: string;
      exitCode: number;
      stdout: { preview: string; byteLength: number; truncated: boolean };
      stderr: { preview: string; byteLength: number; truncated: boolean };
    };
  };
}
```

### Artifact file shape

The artifact file stores the full stdout/stderr payloads so later runtime slices can persist only
summary metadata in the run store while keeping the full report in the targeted repo.

```ts
interface RuntimeShellCheckArtifactFile {
  schemaVersion: 1;
  runId: string;
  stepId: string;
  repoId: string;
  command: string;
  exitCode: number;
  status: "completed" | "failed";
  stdout: { text: string; byteLength: number };
  stderr: { text: string; byteLength: number };
}
```

## BEL-373 durable event sequence

For the supported BEL-366 subset, runtime execution mutates the run store in these sequences:

- `task.agent` stub success:
  - `step.started`
  - `step.completed`
- `check.shell` success:
  - `step.started`
  - `artifact.created`
  - `step.completed`
- `check.shell` non-zero exit:
  - `step.started`
  - `artifact.created`
  - `step.failed`
  - `run.failed`
- terminal success:
  - `step.started`
  - `step.completed`
  - `run.completed`

The runtime executor does not bypass the run store for any step or artifact state in this slice.
