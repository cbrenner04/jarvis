---
name: iteration-timeout-operator-projection
---

# Terminal list/wait/TUI projection, log follow, and recovery copy match iteration-timeout rollover and resumable stalls

## Problem

Operator surfaces hard-code `iteration_timeout` terminal semantics (`resumable` gated on subspec inventory, `nextAction: stop` when false) and do not surface `iteration_timeout_continued` progress boundaries — so rollover looks like a failed run and recovery copy still tells operators to re-dispatch when resume would work.

## Decisions

- `composeRunOperatorError`, `RUN_OPERATOR_ERROR_RECOVERY`, and list/wait/TUI projection treat terminal `iteration_timeout` as `retryable: true` / `nextAction: resume` per the execution intent (inventory fields remain diagnostic, not resumability gates).
- `list` / `wait` rows stay in-progress through non-terminal `iteration_timeout_continued`; only log follow changes for rollover (`boundary_committed` / follow lines expose `iteration_timeout_continued` distinctly from terminal `iteration_timeout` so `jarvis run log` and `jarvis tui log` show rollover without a failed rollup row).
- Plan aligns `docs/operator-runbook.md` recovery section with unconditional resume on terminal stall and notes that in-loop rollover needs no operator action.

## Prerequisites

- Write loop rolls live-output bounded timeouts into the next iteration with `iteration_timeout_continued` attempt settlement and unconditional `resumable: true` on terminal `iteration_timeout` (delivered by: iteration-timeout-progress-rollover)

## Documentation updates

- `docs/v1-behaviors.md` — behavior catalog entries for rollover and terminal stall resume.
- `docs/operator-runbook.md` — `iteration_timeout` recovery copy and rollover vs stall triage.
