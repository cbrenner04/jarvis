# Successor step idle watchdog

## Problem

A workflow-started implement spawns a review, shrink, or publication successor as its own run row; it emits `iteration_started` then produces no further events for tens of minutes while `run list` reports it live. The idle-output watchdog never fires; the row holds the `(project, branch)` claim and blocks re-run until manual `jarvis run kill`.

## Decision ledger

- Reproduce the stalled successor synthetically in `successor-step-idle-watchdog.test.ts` — rules out replaying 2026-08-04 production runs.
- Arm successor idle-output bounds from machine `idleOutputTimeoutMs` immediately after `iteration_started` on the review/shrink/publication dispatch path — rules out agent-only scope, unbounded successors, or fixing an unrelated seam.
- Deferred to first consumer: exact arming helper shape and file placement — pin when the guard lands; must fence pre-agent stalls between `iteration_started` and the first successor-role invocation.
- Defer successor wall-clock bounds — `roleTimeoutMs` already covers review-role invocations once started — rules out duplicating wall-clock policy in this change.
- Successors that create a durable row but omit `iteration_started` must log it before arming — rules out arming only on paths that already emit the event while review-debate rows stay unbounded.
- Idle-budget exhaustion settles a named non-live terminal failure; prefer existing `role_stalled` (`failureKind: "stall"`) and daemon `error.reason: "role_stalled"` — rules out hanging live until operator kill or inventing a write-path-only `idle_output_timeout` reason for successor steps.
- Terminal successor settlement releases the `(project, branch)` claim so `check_workflow_start_claim` / `start` admit a fresh run — rules out a wedged branch.
- Write-step watchdogs and `jarvis run kill` classifier gate stay out of scope — rules out unrelated harness work.

## Prerequisites

- Successor-step dispatch after write-step settlement (review/shrink/publication) in `v2/src/execution/workflow-runner.ts`.
- Write-step idle-output watchdog (`idleOutputTimeoutMs` → `idleOutputMs` → `idle_output_timeout`) in `v2/src/execution/write-loop.ts` and `write-loop-idle-watchdog.test.ts`.
- `implement-completion-honesty` landed (synthetic repro pattern; not production replay).

## Task checklist

- Locate review, shrink (`~shrink`), and publication successor dispatch after write-step settlement; confirm where `iteration_started` is logged and where pre-agent stalls escape existing watchdogs.
- Arm a successor-step idle-output budget from `idleOutputTimeoutMs` after `iteration_started`; honor `0` disable and absent-key → 90 s fallback consistent with review-role invocation.
- On budget exhaustion: commit terminal failure, append `loop_finished`, settle `runStatus: "failed"` with `role_stalled` projection, release registry claim.
- Add `v2/src/execution/successor-step-idle-watchdog.test.ts`: synthetic held-live fixtures per successor kind; assert pre-fix live/unbounded behavior; assert post-fix settlement, `run list`/`wait` projection, and branch-claim release.
- Link a `// @mutate` directive on the arming guard; verify inversion reddens the pinning test.
- Update operator runbook and `v1-behaviors.md`.

## Acceptance criteria

- [ ] `successor-step-idle-watchdog.test.ts` drives a review, shrink, and publication successor that each log `iteration_started` then produce no further output; with the watchdog disabled or pre-fix code the row stays live past the idle budget; with the watchdog armed the same test fails against pre-fix code and passes after the fix.
- [ ] `successor-step-idle-watchdog.test.ts` asserts each silent successor settles within the idle budget: terminal non-live row, `loop_finished` with a stall-class outcome, `run list`/`wait` report `error.reason: "role_stalled"`, and `check_workflow_start_claim` admits a fresh run on the same `(project, branch)`; fails against pre-fix code.
- [ ] `successor-step-idle-watchdog.test.ts` links a `// @mutate` directive on the successor idle-output arming guard in `v2/src/execution/workflow-runner.ts`; inverting turns the settlement pinning test red.
- [ ] `bun run typecheck`, `bun run check`, `bun run lint:md`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust / Recovery — successor-step idle-output watchdog bounds (`idleOutputTimeoutMs`, arming point, settlement reason, claim release); remove the settled-run-row/live-successor manual-kill guidance once shipped.
- `v2/docs/v1-behaviors.md` — record successor-step idle-output watchdog behavior and operator error projection.
