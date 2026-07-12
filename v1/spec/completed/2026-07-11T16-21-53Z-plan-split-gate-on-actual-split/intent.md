---
name: plan-split-gate-on-actual-split
---

# Plan split-integrity gate fires only on an actual split

## Problem

Plan self-review runs `validateSplitIntegrity` whenever the review verdict text
matches `/\bsplit\b/i`. That fires on any verdict mentioning "split" in passing.
When the actuator then makes a normal (non-split) edit, the check sees no
removed/added subspec files and returns "split verdict did not replace the
original subspec", aborting the plan `exit agent-error`. Observed 2026-07-11 on
`workflow-loader-review-debate-steps`; regression from
`plan-one-iteration-subspec-drafting` (#1325).

## Behavior

- Gate split-integrity validation on an actual split having occurred (subspec
  files both removed and added), not on the verdict text mentioning "split". No
  subspec removed/added means no split was performed — not a failure, and must
  not abort the plan.
- When a split did occur, still enforce scope preservation and index-link
  integrity exactly as today.

## Prerequisites

## Out of scope

- Reworking the one-iteration sizing prompts (they are correct).
- Precisely detecting a verdict that genuinely directs an oversized split but
  whose actuator produced no split — a distinct concern, deferred; do not
  conflate it with this false-positive.

## Documentation updates

- `v2/docs/v1-behaviors.md` — correct the plan self-review split-integrity entry
  to reflect gating on an actual split, not verdict text.
