---
name: workflow-detach-after-admission
---

# Non-blocking workflow launch returns after admission

## Problem

Operators background every `jarvis run workflow` by hand because the default attach holds the shell for the whole workflow even though the daemon already owns execution.

## Decisions

- Opt-in `--detach` on `jarvis run workflow <preset>` (default remains attached); rules out a new top-level subcommand or env-only surface.
- Detach runs the same pre-`start` validation, workspace reset, and daemon admission path as attach; only post-admission client wait differs.
- On admitted detach: print the workflow entry run ID (same admission contract as attach), exit `0`, and leave the workflow running under the daemon; rules out implicitly killing or pausing the workflow on client exit.
- Attach vs detach: attach keeps the CLI up through workflow-terminal wait (admission ID plus optional attach-only `workflow-step:` lines); detach issues `start`, prints admission ID, and exits without client-side `wait` or boundary lines.
- Failed admission unchanged; rules out coupling detach to attach wait behavior.
- CLI-only; rules out daemon lifecycle changes.

## Acceptance criteria

- [ ] A new regression in `workflow.test.ts` launches a workflow with `--detach` and asserts the CLI exits `0` after exactly one `start` IPC (no `wait`), with the workflow entry run ID as the first stdout line; fails against pre-fix attach-only behavior.
- [ ] After detach, the workflow continues to completion under the daemon without requiring the launching shell to stay open (daemon fixture reaches workflow entry terminal while the CLI process has already exited).
- [ ] Failed admission preserved: `workflow.test.ts` `run workflow implement passes through daemon guard errors without local workflow logic` stays green (non-zero, named stderr, no run ID on stdout).
- [ ] `bun run typecheck`, `test:v2`, and `test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — detach vs attach launch modes and stdout on each (detach: admission ID only).
- `v2/docs/operator-runbook.md` — launching workflows without blocking a shell; observing via admission run ID.
- `v2/docs/v1-behaviors.md` — document `--detach` alongside attached workflow-terminal wait.

## Prerequisites

- Workflow launch prints the workflow entry run ID on stdout immediately after daemon admission, before any client-side completion wait.
- Attached `jarvis run workflow` blocks until the workflow entry run is terminal (defines attach vs detach contrast).
