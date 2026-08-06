# Scope gate

## Problem

Successor-kind stall scope is unconfirmed. Publication may settle on the write or `~shrink` row (`lastResult.runId`), not a third peer row. Shrink may already enter `executeWriteLoop` with idle-output and wall watchdogs. Review-debate can create a durable row without `iteration_started` today.

## Decision ledger

- Candidate loci (bounded hypotheses, not yet confirmed): successor dispatch arms no idle-output watchdog after `iteration_started` (unlike the write step), or the stall occurs before any agent invocation so existing `roleTimeoutMs` never arms — rules out shipping a fix at an unrelated seam until confirmed.
- Scope gate is **blocking**: no successor-shell arming, settlement, or claim-release work in 01 until this subspec's ledger records confirmed kinds and seams.
- Publication: confirm whether repro belongs on a peer successor row or as completion-tail stall on write/`~shrink`; if tail-only, record distinct arming trigger when `iteration_started` is absent — rules out treating publication as a third peer row by default.
- Shrink: confirm whether dispatch already enters `executeWriteLoop` (write-path idle + wall watchdogs); if yes, exclude redundant workflow-runner shell coverage unless a pre-`executeWriteLoop` stall exists — rules out duplicate shrink watchdogs.
- Review-debate: rule **in** (add `iteration_started` before arming where missing, then shell watchdog) or **defer** with rationale — rules out silent omission while ledger mentions the path.
- If confirmed seams are multiple independent implementation paths (e.g. standard review shell, review-debate shell, daemon claim release), split into additional numbered subspecs from `index.md` before ticking 01; each owns tasks and acceptance outcomes once — rules out prose compression in 01.

## Prerequisites

- Successor-step dispatch after write-step settlement in `v2/src/execution/workflow-runner.ts`.
- Write-step idle-output watchdog in `v2/src/execution/write-loop.ts` and `write-loop-idle-watchdog.test.ts` (comparison only).

## Task checklist

- Locate review, shrink (`~shrink`), publication completion-tail, and review-debate dispatch after write-step settlement; note where `iteration_started` is logged and where pre-agent stalls escape existing watchdogs.
- Record publication, shrink, and review-debate scope rulings in this ledger (in / out / reframed / deferred).
- If multiple independent seams remain, add subspec files and `index.md` links; move claim-release or review-debate-only work out of 01 when not the same seam.
- Pin the successor-shell dispatch boundary(ies) 01 will arm (file + call site); note expected mutation one-liner location.

## Acceptance criteria

- [ ] Decision ledger records a publication scope ruling (peer successor row, completion-tail on write/`~shrink`, or out of scope) with arming trigger when `iteration_started` is absent.
- [ ] Decision ledger records a shrink scope ruling (excluded when `executeWriteLoop` already arms idle output, or limited to any confirmed pre-`executeWriteLoop` stall).
- [ ] Decision ledger records a review-debate scope ruling (in scope with `iteration_started` + shell watchdog, or deferred with rationale).
- [ ] Decision ledger names the dispatch boundary(ies) and successor kinds 01 must cover; if split, `index.md` lists every replacement subspec and 01 scope is narrowed accordingly.

## Documentation updates

None — scope gate only.
