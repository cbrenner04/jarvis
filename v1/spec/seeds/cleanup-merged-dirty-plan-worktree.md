---
name: cleanup-merged-dirty-plan-worktree
---

# Cleanup merged-but-dirty plan worktrees

## Problem

A plan worktree whose PR has merged but still carries stale uncommitted edits
(left by the review actuator or a mid-run kill) cannot be retired by either
cleanup path:

- `jarvis1 cleanup` (merged mode) skips the worktree with
  `skipping <name>: has uncommitted or unpushed changes`.
- `jarvis1 cleanup --abandon <name>` refuses with
  `cannot abandon <name>: branch <branch> PR is merged` (the scoped-abandon
  guard, shipped in #861, treats merged-PR as ineligible).

The operator is left with a worktree that is safe to remove (the PR merged, so
local edits are stale) but no harness command to remove it — forcing a manual
`git worktree remove --force` + branch delete. Observed 2026-06-30 on
`plan-triage-merge-plan-prs` after #863 merged with stale review-actuator edits.

## Scope (for plan → run)

- Teach merged-mode `cleanup` to retire a merged worktree with stale local
  edits when the matching PR is merged (the remote truth wins; local uncommitted
  edits are irrelevant once the PR landed).
- Keep the dirty-skip guard for worktrees whose PR is **not** merged (genuine
  in-flight work that would be lost).

## Out of scope

- Abandon-mode behavior changes (scoped abandon correctly refuses on merged
  PRs; the fix belongs in merged-mode cleanup).
- Reconciling *which* edits matter when a PR merged via squash (local commits
  diverge from remote by definition after squash-merge).

## Decisions (seed-level — refine in plan)

- Merged-mode cleanup retire step force-removes the worktree + deletes the
  local branch when the matching open/closed PR is merged, regardless of local
  porcelain state — rules out leaving a safe-to-remove merged worktree on disk.
- Dirty-skip guard stays for not-merged worktrees — rules out losing
  in-flight uncommitted work.
- Refusal when PR state cannot be determined stays (fail-closed) — rules out
  force-removing a worktree whose merge status is unknown.
- Deferred to first consumer: whether to warn/log about discarded local edits
  before force-remove — pin when CLI UX is drafted.

## Documentation updates

- `v2/docs/v1-behaviors.md` — merged-mode cleanup retires merged-but-dirty
  worktrees; dirty-skip stays for not-merged.
- `v1/docs/operator-runbook.md` — drop the manual `git worktree remove --force`
  workaround once shipped.

## Prerequisites

- `jarvis1 cleanup` merged-mode skips worktrees with uncommitted/unpushed
  changes (`skipping <name>: has uncommitted or unpushed changes`).
- `jarvis1 cleanup --abandon <name>` refuses on merged PR (shipped #861).
