# Plan still over-builds subspecs; enforcement approach was reverted

## Problem

The original premise of `plan-subspec-one-iteration-sizing` still holds: the plan
loop drafts subspecs too large for one patch iteration (13+ dense decisions, many
independent code paths). The 2026-07-11 attempt to fix it (#1325) added a
draft/review prompt "size to one iteration" nudge **plus** a review-actuator
`validateSplitIntegrity` check that aborted the plan unless a split preserved
every task/AC verbatim.

That enforcement was **reverted** (#1349): it did not achieve its aim (the specs
drafted for the feature itself were still monoliths) and it destabilized plan
review — the review actuator naturally rewords when it splits, so the strict
"preserve exactly once" check failed and aborted plans (`agent-error`), observed
on `plan-reviewed-debate`. The advisory draft/review prompt hints were left in
place; `jarvis1 plan --recover` (#1330) stays.

Do **not** re-attempt the same hard-enforcement approach.

## Decisions

- Over-build remains an open problem worth solving with a **lighter touch** than
  hard split-validation — e.g. a size *warning* (not an abort) at plan time, or a
  draft-side budget the drafter self-checks, or relying on `--recover` + the
  three-timeout auto-split blocker for recovery rather than prevention.
- Any new attempt must not abort a plan on imperfect actuator restructuring.

## Prerequisites

- none

## Reference

- Reverted enforcement: #1325 (added), #1349 (reverted). Recovery: #1330 (`--recover`).
- Memory: plan-refine-precision-amplifier.
