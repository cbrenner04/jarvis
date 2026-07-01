---
name: cleanup-retires-merged-dirty-worktrees
---

# Merged-mode cleanup retires merged-but-dirty worktrees

## Problem

A plan worktree whose PR merged but still has stale local edits (review actuator
or mid-run kill) is stuck: merged-mode `jarvis1 cleanup` skips with
`skipping <name>: has uncommitted or unpushed changes`, and scoped
`jarvis1 cleanup --abandon <name>` refuses because the PR is merged. The
operator must manually `git worktree remove --force` + delete the branch.

## Direction

Merged-mode `jarvis1 cleanup` retires worktrees whose matching PR is merged even
when the worktree has uncommitted or unpushed local state. Remote merge truth
wins; stale local edits are discarded.

Preserve the dirty-skip guard for worktrees whose PR is not merged.

## Out of scope

- Abandon-mode behavior (scoped abandon correctly refuses merged PRs).
- Squash-merge local/remote commit reconciliation.

## Decisions

- Merged-mode retire uses force-remove + local branch delete when PR is merged, regardless of porcelain — rules out leaving safe-to-remove merged worktrees on disk.
- Dirty-skip guard stays for not-merged worktrees — rules out discarding in-flight uncommitted work.
- PR-state inspection failure keeps current fail-closed skip (no force-remove when merge status unknown) — rules out retiring worktrees with undetermined merge state.
- Deferred to first consumer: whether to warn/log about discarded local edits before force-remove — pin when CLI UX is drafted.

## Documentation updates

- `v2/docs/v1-behaviors.md` — merged-mode cleanup retires merged-but-dirty worktrees; dirty-skip stays for not-merged.
- `v1/docs/operator-runbook.md` — drop any manual `git worktree remove --force` workaround for merged-but-dirty plan worktrees.

## Prerequisites

- Merged-mode `jarvis1 cleanup` skips worktrees with uncommitted or unpushed changes (`skipping <name>: has uncommitted or unpushed changes`)
- Scoped `jarvis1 cleanup --abandon <name>` refuses when the matching PR is merged (`cannot abandon <name>: branch <branch> PR is merged`)
