---
name: review-actuator-push-failure-diverges-branch
---

# Review actuator push failure diverges the branch and forces a manual finalize

## Problem

On a criteria-complete, gate-green run, the post-completion review actuator can
leave the branch in a diverged state that only a hand-finalize resolves.
Observed this session on `markdown-corpus-normalize`: the implementation commit
was pushed and the PR opened, but the review actuator then committed locally and
its push was **rejected** as non-fast-forward (`Updates were rejected because
the tip of your current branch is behind its remote counterpart`). The run
exited `11` (`review-incomplete`); the local worktree HEAD diverged from the
merged PR head (local actuator commit vs. the pushed implementation commit), and
auto-ready could not ready the PR.

The recovery was manual: confirm the remote/PR head carried the complete, ticked,
lint-clean work (it did), then `gh pr ready` + admin-merge the PR head and
discard the divergent local actuator commit — a hand step the north star wants
the harness to own.

## Direction

Make the review actuator's commit/push resilient to a behind-remote tip, and
keep the branch convergent. Options for plan to weigh:

- Have the actuator fetch/rebase (or fast-forward-check) before committing, so
  it never produces a non-fast-forward push.
- On a rejected actuator push, classify and recover deterministically (the
  implementation+PR head is intact) instead of leaving a diverged worktree for
  the operator to reconcile.
- Confirm the `review-incomplete` auto-ready path still readies the PR head when
  the divergence is solely a failed actuator push (it did not here).

## Out of scope

- The `review-incomplete` exit classification itself (already shipped this
  session).

## References

- Post-completion review actuator commit/push in `v1/src/modes/patch/`.
- Observed 2026-06-24 on `markdown-corpus-normalize` (PR #499).
