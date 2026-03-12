# Runtime Flow Contract

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
.inngest-orchestrator/artifacts/runs/<runId>/steps/<stepId>/shell-check.json
```

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
