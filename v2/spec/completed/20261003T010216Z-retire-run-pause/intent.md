---
name: retire-run-pause
---

# Retire the run pause command and pauseController plumbing

## Problem

`run pause` is a verb with no internal caller, only advertised for ad-hoc write-loop runs which are vestigial. The daemon maintains `pauseController` plumbing (daemon.ts, write-loop.ts) to support pause/resume, but the resume path has a live code/message contradiction: daemon.ts implements queuedInput-backed resume while run-operator-error.ts advertises it unsupported. Pausing a workflow-kind run is rejected (#3853 run-paused incident, correct behavior). The harness-set `paused` status stays; only the operator verb and its plumbing go.

## Decisions

- Delete the `pause` verb from the `run` command surface and TUI parser (tui-command-parser.ts).
- Delete `pauseController` from `ActiveRun` shape (daemon.ts), write-loop executor signature (write-loop.ts), and daemon lifecycle handlers that create or signal it (daemon-run-lifecycle-handlers.ts).
- Keep `paused` status on run rows and the run-paused incident logic; they stay for harness-managed pause during review (#3853).
- Rules out trying to preserve a public pause API in service of write loops.

## Prerequisites

## Acceptance criteria

- [x] `run pause` subcommand is gone; the verb does not appear in `run --help` or `jarvis help run`.
- [x] TUI `pause` key binding is gone; a test verifying its absence passes (e.g., tui-command-parser.test.ts).
- [x] `pauseController` does not exist on `ActiveRun` (daemon.ts); search finds zero instances in daemon, write-loop, and lifecycle-handler files; `grep -rn pauseController v2/src/daemon v2/src/execution --include="*.ts"` returns empty.
- [x] Write-loop executor no longer accepts `pauseSignal` parameter; `write-loop.test-support.ts` and any test invoking the executor no longer pass a pause signal.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — remove any pause-recovery guidance for ad-hoc runs; link to workflow pause (#3853) if present.
- `v2/docs/write-behavior.md` — remove any documentation of `run pause` command surface or TUI pause verb.
- `v2/docs/v1-behaviors.md` — record `run pause` retirement.

## Primary implementation surface

- `v2/src/commands/run.ts` (remove pause verb and isRunAction dispatch)
- `v2/src/tui/tui-command-parser.ts` (remove pause verb from verb list and kind union)
- `v2/src/daemon/daemon.ts` (remove pauseController from ActiveRun shape)
- `v2/src/daemon/daemon-run-lifecycle-handlers.ts` (remove pauseController creation/signaling)
- `v2/src/execution/write-loop.ts` (remove pauseSignal parameter)
