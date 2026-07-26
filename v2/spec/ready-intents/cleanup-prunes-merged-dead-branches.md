---
name: cleanup-prunes-merged-dead-branches
---

# `jarvis cleanup` prunes local and remote-tracking refs for merged branches

## Problem

Operator suggestion, 2026-07-25: cleanup deletes local branches for merged worktrees it retires, but
branches that arrived by other paths — hand-pushed and hand-merged, or worktrees retired earlier —
leave `refs/heads/<branch>` and `refs/remotes/origin/<branch>` behind indefinitely. Those refs are
what let a later materialization resolve pre-merge history.

The gap is asserted, not proven. Confirm cleanup really leaves such refs behind before implementing;
if it does not, say so and stop rather than adding a redundant prune.

## Decisions

- Prune only refs whose PR is merged, or whose commits are already contained in the default branch.
  Rules out deleting work that has not landed.
- Branches with an open PR and unmerged branches are left untouched, regardless of worktree state.
- Prune the remote-tracking ref alongside the local branch. A surviving `origin/<branch>` is the ref
  that misleads materialization.
- Report each pruned ref in cleanup output; silence would make an unexpected deletion undiagnosable.

## Acceptance criteria

- [ ] Cleanup prunes local and remote-tracking refs for branches whose PR is merged, including
      branches with no attached worktree.
- [ ] Branches with an open PR are left untouched.
- [ ] Unmerged branches with no PR are left untouched.
- [ ] Pruned refs appear in cleanup output.
- [ ] If the gap turns out not to be real, the intent records that finding instead of adding a prune.

## Documentation updates

- `v2/docs/operator-runbook.md` — what `jarvis cleanup` now prunes and what it deliberately keeps.
- `v2/docs/v1-behaviors.md` — cleanup's branch-deletion scope.

## Prerequisites

- `jarvis cleanup` retires worktrees and deletes local branches for merged worktrees
- Cleanup can determine a branch's PR state

## Sequencing

Same ref-lifecycle seam as [[stale-remote-tracking-ref-no-longer-resolves-branch]] (both delete
`refs/remotes/origin/<branch>`, one at preflight reset, one at cleanup). Plan this one last, against
that intent's merged result, to avoid two specs independently reshaping remote-tracking-ref deletion.
