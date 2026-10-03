---
name: scoped-file-tools-refuse-out-of-scope-writes
---

# Scoped read, edit, and search tools refuse out-of-scope paths at the call

> Hold: owner sign-off required before `plan`; the seed was marked not dispatchable and this split records the proposed direction only.

## Problem

A ready-gate repair edited files outside its lane's scope and was caught only after the fact; scope fences are prompt text today.

## Decisions

- Jarvis-defined read, write, edit, and search tools resolve every path against the run's scope and refuse out-of-scope writes at the call, returning a named tool error the agent can see.
- Plan must decide the scope model (worktree root vs lane-declared paths) and whether reads outside the worktree are allowed.

## Prerequisites

- A tool server dispatches tool calls for the run (delivered by: harness-tool-server-serves-role-scoped-tools)

## Acceptance criteria

- [ ] `scoped-tools.test.ts`: an in-scope write succeeds and an out-of-scope write is refused by name without touching the file; same for edit; fails against current code (no tools).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — scope enforced at the tool boundary; remaining prompt obligations.

## Primary implementation surface

- `v2/src/execution/scoped-tools.ts` (new)
