---
name: converge-and-ready-pr-head-on-rejected-actuator-push
---

# A rejected actuator push converges to the PR head and readies it, no manual finalize

## Problem

When the review actuator's push is rejected non-fast-forward, the run exits
`11` (`review-incomplete`) with the worktree HEAD diverged: a local actuator
commit on one side, the pushed implementation commit (the merged PR head) on
the other. The intact, ticked, lint-clean work lives on the PR head, but the
operator must hand-finalize — confirm the PR head, `gh pr ready` + admin-merge,
discard the divergent local commit. The north star wants the harness to own
this. Observed on `markdown-corpus-normalize` (PR #499), 2026-06-24.

## Direction

On a rejected actuator push, classify the failure and recover deterministically
instead of leaving a diverged worktree. When the divergence is solely the
failed actuator commit (the PR head carries the complete work), converge the
local branch to the PR head and let the `review-incomplete` auto-ready path
ready it.

## Behavior

- A non-fast-forward actuator push rejection is classified, not surfaced as an
  unrecovered diverged worktree.
- When the only divergence is the failed actuator commit, the branch converges
  to the intact PR head deterministically.
- On `review-incomplete` whose sole divergence is a failed actuator push,
  auto-ready readies the PR head (it did not here).

## Out of scope

- Preventing the rejection up front (pre-push reconcile) — separate behavior.
- The `review-incomplete` exit classification itself (already shipped).

## References

- Actuator commit/push + failure handling in `v1/src/modes/patch/review.ts`
  (~line 960).
- `review-incomplete` auto-ready path in `v1/src/modes/patch/completion-pipeline.ts`
  (`maybeMarkReady`, ~line 555).

## Prerequisites

- Post-completion review actuator commits and pushes its changes after a green completion gate.
- The run classifies a failed post-completion review as the review-incomplete exit and auto-readies the PR when the tree is unchanged.
