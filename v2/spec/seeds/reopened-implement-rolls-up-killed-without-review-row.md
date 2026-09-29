---
name: reopened-implement-rolls-up-killed-without-review-row
---

# A reopened implement that finishes without new attempts rolls up `killed`

## Problem

`pipeline resume` on a failed implement stage reopens it and dispatches a fresh invocation (`v2/src/daemon/pipeline-execution.ts`). When the lane's work and review already landed in the prior invocation, the new entry `implement` row settles `completed` with zero attempts (runs the gate, flips the PR ready) and no `implement-review` row is ever written. The rollup rule "durable step with no row → `killed`" (`v2/src/persistence/workflow-run-status-rollup.ts:86`) then reports `killed`, `pipeline-stage-settlement.ts:145` maps it to `resumable_kill` / `nextAction: resume`, and the stage settles `failed` over a completed lane with a ready PR. Following the advice re-dispatches and loops.

Evidence (2026-09-29): pipeline `f13b29a3`, lane `shard-session-logs-by-month`; entry row `e7b5a8ed` `completed`, `terminal_cause=complete`, `attempt_count=0`, PR #4173 flipped ready; stage `failureDetail` `{reason: resumable_kill, entryRunStatus: killed, terminalCause: complete}`.

## Decisions

- A durable successor step that the workflow legitimately skipped (entry completed with no new work; review already settled for this lane) does not roll up as `killed`. Rules out treating a missing row as proof of a kill when the entry row's own terminal cause is `complete`.
- A stage whose entry row completed with PR evidence settles `succeeded`, not `failed`.

## Acceptance criteria

- [ ] A rollup test proves an invocation whose entry step completed with zero attempts and no successor row rolls up `completed`; it fails against the current `killed`.
- [ ] A settlement test proves the matching pipeline stage settles `succeeded` with the entry row's PR evidence; it fails against the current `resumable_kill`.
- [ ] An invocation whose successor genuinely never ran after a non-complete entry still rolls up `killed` (pins the existing guard).

## Documentation updates

- `v2/docs/pipeline-execution.md` — reopened implement that finishes without new work settles `succeeded`.
