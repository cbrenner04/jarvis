---
name: run-auto-integrate-base-on-behind
---

# Auto-integrate base at final ready when branch is behind base

## Problem

A long `jarvis run` can finish with all criteria checked yet block the draft→ready flip:
`ready flip blocked: branch <b> does not contain base <base>; PR stays draft`. The operator must
hand-run Integration-merge-then-retest for the common conflict-free case. Observed 2026-06-28
on PR #773: one docs-only commit behind base, clean merge possible, but post-actuator lint dirt
reached CI because fix+ready never ran after the block.

## Desired behavior

When patch-run completion reaches the final draft→ready flip and the branch is behind its PR
base, attempt a clean `git merge origin/<base>` in the run worktree. On conflict-free merge,
re-run the `full` ready gate on the merged tree, push integrated commits, then flip ready on
green. On merge conflict or post-merge gate failure, abort the merge, emit today's behind-base
blocked stderr, and leave the PR draft. Triage `--mark-ready` and plan-mode ready flips stay
unchanged.

## Decisions

- On behind-base at patch-run final draft→ready flip, attempt conflict-free `git merge origin/<base>` in the run worktree — rules out leaving every conflict-free behind-base completion on manual Integration-merge-then-retest.
- After conflict-free merge, re-run `full` ready gate (fix + verify + harness commit-if-dirty) on the merged tree before `gh pr ready` — rules out flipping without re-gating the integrated tree and rules out post-actuator lint dirt reaching CI.
- On merge conflict or post-merge gate failure, abort merge and leave PR draft with today's `ready flip blocked: branch … does not contain base …; PR stays draft` message — rules out auto-resolving conflicts that need operator judgment.
- Implement inside patch-run completion flow (`maybeMarkReady` behind-base branch), not a new subcommand — rules out `jarvis1 integrate` or triage/plan behavior churn.
- Deferred to first consumer: whether per-iteration early-ready `maybeMarkReady` call sites share the same auto-integrate branch — pin when call-site scoping is drafted (seed targets final completion flip; central `maybeMarkReady` may cover all sites).

## Documentation updates

- `v1/docs/operator-runbook.md` — conflict-free behind-base auto-integrates at run completion; Integration-merge-then-retest remains for conflicts; remove the concurrency caveat once shipped.
- `v2/docs/v1-behaviors.md` — record behind-base auto-merge + post-merge `full` gate in final draft→ready ordering.

## Prerequisites

- Patch-mode draft→ready flip blocks with stderr when the branch is behind its fetched base and leaves the PR draft
