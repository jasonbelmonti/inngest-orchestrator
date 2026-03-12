# inngest-orchestrator

Local workflow orchestrator for the broader Agent Cockpit initiative.

Planning starts from [docs/inngest-orchestrator-mvp-plan.md](./docs/inngest-orchestrator-mvp-plan.md).
The current implemented slices are the config-root workflow schema and the workflow authoring CLI
documented in [docs/workflow-schema.md](./docs/workflow-schema.md).
It now also includes the first local daemon API documented in [docs/daemon-api.md](./docs/daemon-api.md).

To install dependencies:

```bash
bun install
```

To test:

```bash
bun run test
bun run typecheck
bun run ci:lint
bun run ci:format-check
```

Workflow CLI:

```bash
bun ./src/cli.ts workflow list --config-root ./examples/config-root
bun ./src/cli.ts workflow read cross-repo-bugfix --config-root ./examples/config-root
echo '{ "document": { ... } }' | bun ./src/cli.ts workflow validate --config-root ./examples/config-root
```

Use the direct `bun ./src/cli.ts ...` entrypoint for machine-consumable JSON output. `bun run <script>`
adds Bun wrapper output on non-zero exits.

Local daemon:

```bash
bun ./src/daemon.ts
```

Default daemon bind:

- `127.0.0.1:3017`
- SQLite at `.local/inngest-orchestrator.sqlite`

Manual SSE restart check:

```bash
curl -N http://127.0.0.1:3017/runs/run-001/events
# disconnect the stream, restart bun ./src/daemon.ts, then reconnect with Last-Event-ID: 1
curl -N http://127.0.0.1:3017/runs/run-001/events \
  -H 'Last-Event-ID: 1'
curl -s -X POST http://127.0.0.1:3017/runs/run-001/control \
  -H 'content-type: application/json' \
  -d '{"action":"cancel","reason":"operator stopped run"}'
```

Restart recovery for SSE is replay-based:

- open streams do not survive daemon restart
- reconnect with `Last-Event-ID` to recover persisted events and continue live delivery

CI commands:

```bash
bun run ci:test
bun run ci:smoke
bun run ci:security
bun run ci:coverage
```

A GitHub Actions workflow now runs:

- typecheck/tests
- lint/format checks
- CLI contract smoke checks (`list`, `read`, `validate`, `save`, malformed inputs, and missing config root)
- bun audit on a weekly schedule + manual dispatch

Example config root:

- `examples/config-root`

Recommended default:

- keep real cross-project workflows in a dedicated workflow repo
- point the orchestrator at that repo with `--config-root` or `AGENT_ORCHESTRATOR_CONFIG_ROOT`

This project was created using `bun init` in bun v1.3.0. [Bun](https://bun.com) is a fast
all-in-one JavaScript runtime.
