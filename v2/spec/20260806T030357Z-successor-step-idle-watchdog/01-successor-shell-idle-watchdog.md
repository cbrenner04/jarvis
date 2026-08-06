# Successor shell idle watchdog

## Problem

A workflow-started implement spawns a successor that logs `iteration_started` then produces no further events for tens of minutes while `run list` reports it live. No idle bound covers the pre-agent shell; the row holds the `(project, branch)` claim and blocks re-run until manual `jarvis run kill`.

## Decision ledger

- Reproduce stalled successors synthetically in `successor-step-idle-watchdog.test.ts` with a **short idle budget** (~20 ms machine override or harness, per `write-loop-idle-watchdog.test.ts`) — rules out CI waiting on 90 s default or replaying 2026-08-04 production runs.
- Synthetic held-live repro follows `heldLiveBindingFactory` in `daemon-workflow-start.test.ts` (or equivalent) — rules out inventing ad-hoc stall fixtures.
- Implement only successor kinds and seams **confirmed in-scope** by [00 - Scope gate](./00-scope-gate.md); do not arm publication as a peer row if 00 reframed it as completion-tail stall.
- Successor **shell** idle budget uses **review-role semantics**: absent `idleOutputTimeoutMs` → 90 s (`DEFAULT_IDLE_OUTPUT_TIMEOUT_MS`); `0` disables at the shell layer — rules out write-path semantics where absent/`0` disables and settles `idle_output_timeout`.
- Arm shell idle output from `idleOutputTimeoutMs` immediately after `iteration_started` on each in-scope dispatch boundary; durable rows that omit `iteration_started` must log it before arming (per 00 review-debate ruling).
- **Handoff:** cancel/disarm the shell idle watchdog when the first role invocation begins (`invokeReviewRole` entry, shrink handoff into `executeWriteLoop`, review-debate `onRoleStart`) — rules out double-settle or race with role-layer watchdogs.
- **Reset semantics:** shell timer does not reset on incidental log events after `iteration_started`; only first role invocation (or first agent stream progress at that boundary) disarms/resets — rules out accidental indefinite extension.
- Defer successor wall-clock bounds — `roleTimeoutMs` covers review-role invocations once started — rules out duplicating wall-clock policy here.
- Idle-budget exhaustion settles terminal non-live failure via existing **`role_stalled`** projection (`failureKind: "stall"`), not write-path `idle_output_timeout` — rules out operator kill or divergent reason strings.
- Pre-agent shell stall (no role invoked): `invocationFailureDetail` present with `failureKind: "stall"` and `boundMs` from the idle budget; omit `agent`/`model` — rules out implying a role ran.
- Operator-visible settle matches post-commit review stall (`preserve-committed-work-when-review-step-stalls`): `loop_finished` stall-class outcome; `run list` / `run wait` report `error.reason: "role_stalled"`, `failureKind: "stall"`, `resumable: true`, `retryable: true`, `nextAction: "retry_later"`.
- Terminal successor settlement releases the `(project, branch)` claim; verify via daemon IPC (`makeIpcClient` stale-reset helpers, `check_workflow_start_claim` admits a fresh `start` on the same pair) — rules out store-only tests that leave the branch wedged.
- **Out of scope:** write-step watchdogs; `jarvis run kill` classifier gate; `finishReviewedLanding`; resume finalization paths; `replayMutationFinalization`; other landing/resume/finalization `iteration_started` emitters outside implement successor dispatch after write-step settlement.

## Prerequisites

- [00 - Scope gate](./00-scope-gate.md) complete (ledger records confirmed kinds and dispatch boundaries).
- Write-step idle-output watchdog (`idleOutputTimeoutMs` in `write-loop.ts`) as harness/model reference only.
- Synthetic repro discipline (short idle budget, held-live bindings); not shared fixtures from `implement-completion-honesty`.

## Task checklist

- Arm successor-shell idle output at each in-scope boundary from 00; honor review-role absent-key → 90 s and `0` disable.
- Implement handoff and reset semantics at first role invocation per kind in scope.
- On shell idle exhaustion: commit terminal failure, append `loop_finished`, settle `runStatus: "failed"` with `role_stalled` projection and pre-agent `invocationFailureDetail` when no role ran; unwind registry claim.
- Add `v2/src/execution/successor-step-idle-watchdog.test.ts`: held-live synthetic fixtures per **in-scope** kind; pin ~20 ms idle budget; assert pre-fix live/unbounded pinning and post-fix settlement projection.
- Add daemon-level claim-release coverage (extend `daemon-workflow-start.test.ts` or sibling) tracing terminal settlement → `check_workflow_start_claim` admits re-run.
- Link `// @mutate` on the successor-shell idle arming **one-liner** at the boundary pinned in 00 (expected `workflow-runner.ts` review dispatch when that seam is in scope).
- Update operator runbook, `daemon-host.md`, and `v1-behaviors.md`.

## Acceptance criteria

- [x] `successor-step-idle-watchdog.test.ts` drives each **in-scope** successor kind from 00 through `iteration_started` then silence with a ~20 ms idle budget; the pinning test **fails against pre-fix code** (row stays live past the budget) and **passes after** shell idle arming lands.
- [x] `successor-step-idle-watchdog.test.ts` asserts each silent in-scope successor settles within the idle budget: terminal non-live row; `loop_finished` with stall-class outcome; `run list` / `run wait` report `error.reason: "role_stalled"`, `failureKind: "stall"`, `resumable: true`, `retryable: true`, `nextAction: "retry_later"`; pre-agent stall includes `invocationFailureDetail` with `failureKind: "stall"` and `boundMs` and no `agent`/`model`; **fails against pre-fix code**.
- [x] Daemon integration test (e.g. `daemon-workflow-start.test.ts` held-live pattern) asserts terminal successor settlement releases the branch claim and `check_workflow_start_claim` admits a fresh run on the same `(project, branch)`; **fails against pre-fix code**.
- [x] `successor-step-idle-watchdog.test.ts` links a `// @mutate` directive on the successor-shell idle arming one-liner at the 00-pinned dispatch boundary; inverting turns the settlement pinning test red.
- [x] `successor-step-idle-watchdog.test.ts` asserts `idleOutputTimeoutMs: 0` disables shell idle arming for an in-scope kind (row stays live past a short harness budget when disabled).
- [x] `bun run typecheck`, `bun run check`, `bun run lint:md`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust / Recovery — successor-shell idle bounds (`idleOutputTimeoutMs`, arming after `iteration_started`, handoff at first role, `role_stalled` settle, claim release); remove settled-run-row/live-successor manual-kill guidance once shipped.
- `v2/docs/daemon-host.md` — `role_stalled` projection for successor-shell pre-agent stall (`retryable`, `nextAction`, `invocationFailureDetail` when no role ran).
- `v2/docs/v1-behaviors.md` — successor-shell idle-output watchdog and operator error projection.
