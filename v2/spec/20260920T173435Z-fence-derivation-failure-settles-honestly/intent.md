---
name: fence-derivation-failure-settles-honestly
---

# Fence-derivation failure is logged and does not fail a published lane

## Problem

The write-loop call site (`v2/src/execution/write-loop.ts`, `initializeFrozenRepairAllowset` and the completion path) turns a derivation failure into a bare `Error`, logs nothing to the run log, settles `completion_commit_failed` after the branch is pushed and the draft PR open, and offers `nextAction: resume` though resume replays the same derivation (fixed point, #3423, #4004).

## Decisions

- This lane makes `deriveGateAllowedPaths` (`v2/src/execution/ready-finalize.ts`) return a distinct named reason for every failure instead of bare `undefined`: `git diff` base...HEAD threw or returned null; `git ls-files` untracked inventory threw or returned null; spec scope unresolvable (spec path invalid, or scope root missing); spec-tree path failed validation; diff output unparseable; untracked output unparseable; a collected path failed repo-relative validation. Rules out any failure collapsing to bare `undefined`.
- The caller writes the named derivation-failure reason as a durable run-log record before settling; rules out the reason existing only on the `run list` row.
- A fence-derivation failure on a lane whose work is complete, pushed, and published does not settle `failed`; with no repair in flight it proceeds to flip-to-ready; rules out `completion_commit_failed` on an already-published lane.
- `nextAction` reflects what resume would retry; a derivation failure resume cannot fix projects `stop` with the reason; rules out an unbased `resume` (shared mechanism with [[terminal-state-honesty-invariant]]).

## Acceptance criteria

- [ ] A ready-finalize test drives each derivation failure above and asserts its distinct named reason; none returns bare `undefined`.
- [ ] A write-loop test proves an `implement-review` completion with an empty review scope reaches flip-to-ready instead of settling `completion_commit_failed`, and `jarvis run resume` on such a row is not a fixed point.
- [ ] A write-loop test asserts the named derivation-failure reason is written to the run log before settlement; it fails against the pre-fix unlogged bare `Error`.
- [ ] A write-loop test proves a lane with branch pushed, PR open, and all criteria ticked does not settle `completion_commit_failed` on a fence-derivation failure and does not advertise `nextAction: "resume"`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — what a fence-derivation failure means and why resume is not the recovery.
- `v2/docs/write-behavior.md` — logged derivation failure and honest settlement.
- `v2/docs/v1-behaviors.md` — record honest settlement on fence-derivation failure.

## Prerequisites

- Allowset derivation succeeds for external spec homes and yields an empty allowset for an existing empty spec scope (landed, #4076).

## Blocker

- Unresolved decision: what honest settlement is for a red ready gate plus an underivable repair fence.
- Both derivation sites (`initializeFrozenRepairAllowset`, the `dispatchReadyGateAutofix` catch) run inside `publishWithReadyRepair` past `isActiveReadyGateFailure(outcome)` (`write-loop.ts:4124`), so every fence-derivation failure occurs with the ready gate just failed red.
- The third decision's "work is complete, pushed, and published; proceed to flip-to-ready" is false on "complete": flipping via `skipReadyGate` (a markdown-only seam) marks a PR ready with a known-red gate.
- The operator must choose the settlement for red gate + underivable fence, then revise the third and fourth decisions and the flip-to-ready acceptance criteria, before a spec is drafted.
- Preserved for the reworked intent: named derivation-failure reasons; run-log record before settlement; no `nextAction: resume` on a fixed-point derivation failure.
