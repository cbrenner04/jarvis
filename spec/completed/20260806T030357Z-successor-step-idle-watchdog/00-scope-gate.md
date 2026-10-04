# Scope gate

## Problem

Successor-kind stall scope is unconfirmed. Publication may settle on the write or `~shrink` row (`lastResult.runId`), not a third peer row. Shrink may already enter `executeWriteLoop` with idle-output and wall watchdogs. Review-debate can create a durable row without `iteration_started` today.

## Decision ledger

- **Confirmed locus:** durable successor review/review-debate dispatch in `workflow-runner.ts` arms no shell idle-output watchdog after `iteration_started`; pre-agent stalls escape `roleTimeoutMs` (arms only at `invokeReviewRole` entry in `review-role-invocation.ts`). Write-step `executeWriteLoop` idle bounds do not cover this shell window.
- Scope gate is **blocking**: no successor-shell arming, settlement, or claim-release work in 01 until this subspec's ledger records confirmed kinds and seams.
- **Publication — out of scope (completion-tail, not peer successor row).** `executeWorkflow` publication tail (`workflow-runner.ts` ~923–1128) settles on `lastResult.runId` (write step or hidden `~shrink` row per ~816–837); it does not create a third durable successor row. Tail entry marks the existing row `in-progress` (~1027) without a new `iteration_started`. Distinct arming trigger when `iteration_started` is absent: row already `in-progress` from prior write/shrink completion; tail stall is a separate seam (resume/finalization paths: `finishReviewedLanding`, `resumePopulatedIntentPublication`, `replayMutationFinalization`) — all excluded from 01 per its out-of-scope list.
- **Shrink — excluded from successor-shell.** `runShrinkAfterImplementComplete` (~1525–1572) dispatches only through `prepareWorkflowStep` then `executeWriteLoop` (~1568). `executeWriteLoop` logs `iteration_started` and runs `awaitIteration` wall + optional write-path `idleOutputMs` watchdog (`write-loop.ts` ~905–914, ~1442–1491). No confirmed pre-`executeWriteLoop` stall venue beyond synchronous store prep. Redundant workflow-runner shell coverage not required.
- **Review-debate — in scope.** `runReviewDebateStep` (~1776–1822) creates a durable row and `recordAttemptStart` but omits `iteration_started` before `executeReviewDebate`. `tryActuatorOnlyReviewDebateRetry` (~1978–2031) also omits it. 01 must log `iteration_started` then arm shell idle output before first role (`executeReviewDebate` / `invokeReviewRole`).
- **Standard durable review — in scope.** `runReviewDispatch` (~4023–4028) logs `iteration_started` for durable reviewed-intent steps then enters `runStandardReviewStep` with no shell idle bound before first `invokeReviewRole`.
- **Non-durable review (profile/light, no landing row) — out of scope.** Synthesized `runId`, no `iteration_started`, no claim-holding durable row — not the repro model.
- **Subspec split — not required.** Standard review shell, review-debate `iteration_started` + shell, and daemon claim-release verification share one successor-shell mechanism at `workflow-runner.ts` call sites; 01 covers all in-scope kinds. Claim release is test harness in 01, not a separate implementation subspec.
- **01 dispatch boundaries (pin):**
  1. `runReviewDispatch` — immediately after `logSink?.append(ids.runId, { kind: "iteration_started", attemptId: ids.attemptId })` (~4024), before `runStandardReviewStep` (~4028); durable `review` with landing only.
  2. `runReviewDebateStep` — after `store.recordAttemptStart(runId)` (~1785), add `iteration_started`, arm shell watchdog, before `executeReviewDebate` (~1816).
  3. `tryActuatorOnlyReviewDebateRetry` — after `store.recordAttemptStart(runId)` (~1980), add `iteration_started`, arm shell watchdog, before `invokeReviewRole` (~2031).
- **Expected mutation one-liner:** `armSuccessorShellIdleWatchdog(...)` (or equivalent) at each boundary above; `// @mutate` in 01 pins the `runReviewDispatch` call (~4024).
- **01 successor kinds:** durable `review` (reviewed-intent landing), `review-debate` (full debate + actuator-only retry path).

## Prerequisites

- Successor-step dispatch after write-step settlement in `v2/src/execution/workflow-runner.ts`.
- Write-step idle-output watchdog in `v2/src/execution/write-loop.ts` and `write-loop-idle-watchdog.test.ts` (comparison only).

## Task checklist

- Locate review, shrink (`~shrink`), publication completion-tail, and review-debate dispatch after write-step settlement; note where `iteration_started` is logged and where pre-agent stalls escape existing watchdogs.
- Record publication, shrink, and review-debate scope rulings in this ledger (in / out / reframed / deferred).
- If multiple independent seams remain, add subspec files and `index.md` links; move claim-release or review-debate-only work out of 01 when not the same seam.
- Pin the successor-shell dispatch boundary(ies) 01 will arm (file + call site); note expected mutation one-liner location.

## Acceptance criteria

- [x] Decision ledger records a publication scope ruling (peer successor row, completion-tail on write/`~shrink`, or out of scope) with arming trigger when `iteration_started` is absent.
- [x] Decision ledger records a shrink scope ruling (excluded when `executeWriteLoop` already arms idle output, or limited to any confirmed pre-`executeWriteLoop` stall).
- [x] Decision ledger records a review-debate scope ruling (in scope with `iteration_started` + shell watchdog, or deferred with rationale).
- [x] Decision ledger names the dispatch boundary(ies) and successor kinds 01 must cover; if split, `index.md` lists every replacement subspec and 01 scope is narrowed accordingly.

## Documentation updates

None — scope gate only.
