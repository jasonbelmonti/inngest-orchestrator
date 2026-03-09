# inngest-orchestrator

Local workflow orchestrator for the broader Agent Cockpit initiative.

Planning starts from [docs/inngest-orchestrator-mvp-plan.md](./docs/inngest-orchestrator-mvp-plan.md).
The current implemented slice is the config-root workflow schema and storage contract documented in
[docs/workflow-schema.md](./docs/workflow-schema.md).

To install dependencies:

```bash
bun install
```

To test:

```bash
bun run test
bun run typecheck
```

Workflow CLI:

```bash
bun run workflow list --config-root ./examples/config-root
bun run workflow read cross-repo-bugfix --config-root ./examples/config-root
echo '{ "document": { ... } }' | bun run workflow validate --config-root ./examples/config-root
```

Example config root:

- `examples/config-root`

Recommended default:

- keep real cross-project workflows in a dedicated workflow repo
- point the orchestrator at that repo with `--config-root` or `AGENT_ORCHESTRATOR_CONFIG_ROOT`

This project was created using `bun init` in bun v1.3.0. [Bun](https://bun.com) is a fast
all-in-one JavaScript runtime.
