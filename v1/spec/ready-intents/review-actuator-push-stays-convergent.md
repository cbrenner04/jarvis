---
name: review-actuator-push-stays-convergent
---

# Review actuator push reconciles with remote so it never diverges the branch

## Problem

On a criteria-complete, gate-green run the post-completion review actuator
commits locally and pushes. When the remote tip moved ahead (the
implementation commit was already pushed and the PR opened), the actuator's
push is rejected non-fast-forward and the worktree HEAD diverges from the PR
head — forcing a manual finalize. Observed on `markdown-corpus-normalize`
(PR #499), 2026-06-24.

## Direction

Before the actuator commits/pushes, reconcile its local tip with the remote
(fetch + fast-forward-check or rebase) so its push is always a fast-forward and
the branch stays convergent. Push rejection should be impossible in the
common case, not just handled after the fact.

## Behavior

- Actuator reconciles with the remote before pushing; when the remote tip is
  ahead, the actuator push still succeeds and the worktree does not diverge.
- A clean (no actuator changes) pass is unaffected.

## Out of scope

- Recovery after a push is nonetheless rejected (race window) — separate
  behavior.
- The `review-incomplete` exit classification itself (already shipped).

## References

- Actuator commit/push in `v1/src/modes/patch/review.ts` (~line 960).
- `pushCurrent` in `v1/src/worktree.ts`.

## Prerequisites

- Post-completion review actuator commits and pushes its changes after a green completion gate.
