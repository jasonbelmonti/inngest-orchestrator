---
description: Use Bun instead of Node.js, npm, pnpm, or vite.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

## Operating Manual

### General

- Prefer smaller, focused modules over large mixed-responsibility files.
- Split types, implementations, and utilities when a module starts accumulating unrelated concerns.
- Execute work in git worktrees when feasible.
  - Create repo-local worktrees under `/.worktrees`.
  - Exception: if the repository is still on an unborn branch with no commits, use the primary worktree until the first commit exists.

### Project Management

- When creating or updating tasks in Linear or any other project-management system, always use the task rubric below.
- Tasks must be independently executable with minimal supervision. If a task still requires significant implementer decision-making, split it further or add the missing detail before creating it.
- Tasks must contain materially verifiable success criteria. Avoid vague completion language like "works well" or "clean up."
- Tasks must include explicit sequencing and dependency information:
  - what this task depends on
  - what it blocks
  - whether it can run in parallel with sibling work
- Tasks must include a level-of-effort estimate.
  - Always provide at least story points and a brief expected change-scope note such as likely files touched or rough LOC band.
- Prefer a parent issue plus child execution slices when the work is larger than one focused implementation unit.

#### Required Task Template

Every implementation task should include:

1. Summary
2. Scope and concrete implementation changes
3. Public interface, contract, schema, or behavior changes
4. Dependencies and sequencing notes
5. Materially verifiable success criteria
6. Test and validation expectations
7. Level-of-effort estimate
8. Explicit assumptions or defaults chosen

#### Success Criteria Rules

- Success criteria must be externally checkable by a reviewer.
- Prefer statements that reference observable behavior, concrete outputs, commands, UI states, API responses, persisted records, or test coverage.
- If UI changes are involved, require screenshots or equivalent visual evidence in the task.
- If runtime or workflow behavior changes are involved, require at least one end-to-end or smoke validation path.

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";

// import .css files directly and it works
import './index.css';

import { createRoot } from "react-dom/client";

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.md`.
