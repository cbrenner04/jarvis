# Plan split-integrity gate misfires on any verdict mentioning "split"

## Problem

`v1/src/modes/plan/review.ts` runs `validateSplitIntegrity` whenever the review
verdict text merely matches `/\bsplit\b/i` (line ~953). That heuristic fires on
any verdict that mentions the word "split" in passing — not only on an
oversized-subspec split directive. When the actuator then makes a normal
(non-split) edit, `validateSplitIntegrity` sees no removed/added subspec files
and returns `"split verdict did not replace the original subspec"`, so the plan
aborts `exit agent-error`.

Observed 2026-07-11 driving `workflow-loader-review-debate-steps`: the plan
review verdict mentioned "split" incidentally and the plan hard-failed across all
attempts, blocking the spec. Regression introduced by
`plan-one-iteration-subspec-drafting` (#1325).

## Decisions

- Gate split-integrity validation on an actual split having occurred, not on the
  verdict text mentioning "split". "No subspec was removed/added" means no split
  was performed — that is not a failure and must not abort the plan.
- Preserve the real check: when a split *did* occur (files removed and added),
  still enforce scope preservation and index-link integrity exactly as today.
- A verdict that genuinely directs an oversized split but whose actuator produced
  no split is a distinct concern; do not conflate it with the false-positive
  above. If retained, detect it more precisely than a bare word match.

## Prerequisites

- none

## Out of scope

- Reworking the one-iteration sizing prompts themselves (they are correct).

## Reference

- `v1/src/modes/plan/review.ts` — `validateSplitIntegrity` and its call site.
- Shipped by `plan-one-iteration-subspec-drafting` (#1325).

## Documentation updates

- `v2/docs/v1-behaviors.md` — correct the plan self-review split-integrity
  behavior entry to reflect gating on an actual split, not verdict text.
