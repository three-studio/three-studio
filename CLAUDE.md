# Three Studio

A desktop 3D game editor built on Three.js (WebGPU), React and Electron.
See `docs/ARCHITECTURE.md` for how the pieces fit, and `README.md` for how to run it.

## There is a refactor in progress. Read this first.

A large re-architecture is underway on the `refactor/architecture` branch. It is not held in any
conversation — it lives in `docs/chantier/`, so that any session can pick it up cold.

**If the user says `go` (or "continue the chantier", or anything of that shape), do this:**

1. Read `docs/chantier/README.md` — it is the loop, and it is short.
2. Read `docs/chantier/STATE.md` — it names the current task.
3. Do exactly that one task. Not the next one too.

Do not start refactoring from your own reading of the code. The analysis is already done and written
down in `docs/chantier/PLAN.md`; the tasks are derived from it. If something in a task looks wrong
against the code you are reading, say so and stop — a task that no longer matches reality is worth more
as a question than as a guess.

## Conventions this repo already holds you to

- **Comments explain *why*, at length where the why cost someone a morning.** Match that. A comment
  restating the code is noise; a comment naming the failure that shaped the code is the point.
- **Add fields, never remove them, in anything persisted.** Fill missing ones from the type's own
  factory, never from a second list. Leave unrecognised data exactly as found.
- **A reference is an id** — never a name, never a path.
- `packages/core` imports nothing but `.` and `node:`. `packages/runtime` never imports the editor.
  Both are enforced by test.
- `npm run typecheck && npm test` must be green at every commit.
