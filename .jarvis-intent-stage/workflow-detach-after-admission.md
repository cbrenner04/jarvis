---
name: workflow-detach-after-admission
---

# Non-blocking workflow launch returns after admission

## Problem

Operators background every `jarvis run workflow` by hand because the default attach holds the shell for the whole workflow even though the daemon already owns execution.

## Decisions

- Add a non-blocking launch mode on `jarvis run workflow` that returns promptly after successful daemon admission; rules out a new top-level subcommand.
- On admitted detach: print the workflow entry run ID (same admission contract as attach), exit `0`, and leave the workflow running under the daemon; rules out implicitly killing or pausing the workflow on client exit.
- Attach vs detach: attach keeps the CLI up through workflow-terminal wait (with admission ID and optional boundary lines); detach issues `start`, prints admission ID, and exits without client-side `wait`.
- Deferred to plan subspec: whether non-blocking launch is the default or opt-in via flag — pin when drafting CLI surface.
- Failed admission unchanged; rules out coupling detach to attach wait behavior.
- CLI-only; rules out daemon lifecycle changes.

## Acceptance criteria

- [ ] A regression test in `workflow.test.ts` launches a workflow in detach mode and asserts the CLI exits `0` after exactly one `start` IPC (no `wait`), with the workflow entry run ID on stdout; it fails against pre-fix attach-only behavior.
- [ ] After detach, the workflow continues to completion under the daemon without requiring the launching shell to stay open (daemon fixture reaches workflow entry terminal while the CLI process has already exited).
- [ ] A failed admission still exits non-zero with the existing named failure (no run ID line).
- [ ] `bun run typecheck`, `test:v2`, and `test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — detach vs attach launch modes and stdout on each.
- `v2/docs/operator-runbook.md` — launching workflows without blocking a shell; observing via admission run ID.
- `v2/docs/v1-behaviors.md` — document detach launch alongside attached workflow wait.

## Prerequisites

- Intent `workflow-print-run-id-at-admission` implemented (admission run ID on stdout before any client wait).
- Intent `workflow-attached-waits-for-terminal` implemented (attach vs detach semantics for client-side wait).
