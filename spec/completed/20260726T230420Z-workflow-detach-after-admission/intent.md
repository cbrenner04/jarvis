---
name: workflow-detach-after-admission
---

# Non-blocking workflow launch returns after admission

## Problem

Operators background every `jarvis run workflow` by hand because the default attach holds the shell
for the whole workflow even though the daemon already owns execution.

The attach contract it contrasts with is also unguarded. Daemon entry `wait` already awaits
workflow-terminal rollup on `main`, but `workflow.test.ts` only exercises mocked single `wait` frames
— a client that exited after the first constituent row would still pass, and the operator docs still
describe attached launch returning on the first constituent run.

## Decisions

- Opt-in `--detach` on `jarvis run workflow <preset>` (default remains attached); rules out a new
  top-level subcommand or env-only surface.
- Detach runs the same pre-`start` validation, workspace reset, and daemon admission path as attach;
  only post-admission client wait differs.
- On admitted detach: print the workflow entry run ID (same admission contract as attach), exit `0`,
  and leave the workflow running under the daemon; rules out implicitly killing or pausing the
  workflow on client exit.
- Attach keeps the CLI up through workflow-terminal wait; detach issues `start`, prints the admission
  ID, and exits without client-side `wait`.
- Pin the attach side in the same change: final stdout JSON and exit code describe the **workflow
  entry** outcome, not an intermediate constituent row. Rules out reusing today's single-run `wait`
  completion as the command outcome.
- Failed admission unchanged; rules out coupling detach to attach wait behavior.
- CLI-only; rules out daemon lifecycle changes.

## Acceptance criteria

- [ ] A new regression in `workflow.test.ts` launches a workflow with `--detach` and asserts the CLI
      exits `0` after exactly one `start` IPC (no `wait`), with the workflow entry run ID as the first
      stdout line; fails against pre-fix attach-only behavior.
- [ ] After detach, the workflow continues to completion under the daemon without the launching shell
      staying open (daemon fixture reaches workflow entry terminal while the CLI has already exited).
- [ ] A regression using a multi-row workflow daemon fixture and the real attached CLI process (no
      mocked early exit) asserts the process has not exited while a second constituent row is still
      non-terminal, and only exits once the workflow entry run is terminal; it fails if the client
      stops waiting after the first constituent completion.
- [ ] That test also asserts final stdout minified JSON and exit code match the workflow entry
      terminal rollup, not an intermediate constituent row.
- [ ] Failed admission preserved: `workflow.test.ts` `run workflow implement passes through daemon
      guard errors without local workflow logic` stays green (non-zero, named stderr, no run ID on
      stdout).

## Documentation updates

- `v2/docs/write-behavior.md` — detach vs attach launch modes, stdout on each, and attached wait
  semantics (exit zero on attach means the workflow finished, not merely the first step).
- `v2/docs/operator-runbook.md` — launching workflows without blocking a shell; observing via the
  admission run ID.
- `v2/docs/v1-behaviors.md` — `--detach` alongside attached workflow-terminal wait.

## Prerequisites

- Workflow launch prints the workflow entry run ID on stdout immediately after daemon admission
  (already the behavior on `main`).
- Daemon rollup on entry `wait`/`list` reports the workflow entry run's terminal outcome.
