# 02 - Document operator timeout projection

## Problem

`docs/daemon-host.md` still documents a legacy `iteration_timeout` row with `resumable: false` / `stop`, and the behavior catalog does not state that daemon `list`/`wait`/TUI projection treats terminal wall stalls as unconditionally resumable and keeps runs in-progress through `iteration_timeout_continued` rollover.

## Decisions

- Update `docs/daemon-host.md` operator-error table: terminal `iteration_timeout` is always `retryable: true` / `nextAction: "resume"`; remove or replace the legacy `resumable: false` row; note in-progress rollover does not project a terminal `error` row; rules out documenting inventory or `loop_finished.resumable` as list/wait gates.
- Extend `docs/v1-behaviors.md` with harness additive/change bullets for operator projection of rollover (`in-progress` through `iteration_timeout_continued`) and unconditional terminal-stall resume on `list`/`wait`/recovery copy; rules out duplicating write-loop settlement prose already covered by iteration-timeout-progress-rollover.
- Align `docs/operator-runbook.md` only where `RUN_OPERATOR_ERROR_RECOVERY` or list/wait triage bullets still contradict unconditional terminal-stall resume or omit rollover-without-operator-action; rules out re-editing write-loop mechanics already aligned in the rollover spec.

## Task checklist

- [x] Edit `docs/daemon-host.md` `iteration_timeout` operator-error mapping and rollover note.
- [x] Edit `docs/v1-behaviors.md` operator projection entries.
- [x] Edit `docs/operator-runbook.md` recovery/triage copy if still inconsistent after subspecs 00–01.

## Acceptance criteria

- [x] `docs/daemon-host.md` documents unconditional `resume` for terminal `iteration_timeout` on `list`/`wait` and states that in-loop `iteration_timeout_continued` leaves the run `in-progress` without terminal error projection.
- [x] `docs/v1-behaviors.md` records list/wait/TUI/log-follow projection for rollover and unconditional terminal-stall resume (sources cite `src/daemon/run-operator-error.ts`, `src/daemon/workflow-list-snapshot.ts`, and log-follow formatters as applicable).
- [x] `docs/operator-runbook.md` triage for terminal stall vs in-loop rollover matches subspecs 00–01 (resume on terminal stall; no operator action required for rollover).

## Documentation updates

- `docs/daemon-host.md`
- `docs/v1-behaviors.md`
- `docs/operator-runbook.md`
