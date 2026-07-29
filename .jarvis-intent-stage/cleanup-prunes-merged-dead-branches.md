---
name: cleanup-prunes-merged-dead-branches
---

# `jarvis cleanup` prunes local and remote-tracking refs for merged branches

Single surface: the v2 cleanup command (`v2/src/commands/cleanup.ts`). PR-state
determination (`gh pr view`/`gh pr list`) already lives here, so splitting does
not apply — one behavior on one seam.

## Gap (confirmed)

Verified against `v2/src/commands/cleanup.ts`: branch deletion is strictly
worktree-coupled. Default `jarvis cleanup` only enumerates materialized
worktrees under `~/.jarvis/worktrees/<project>/`, so a merged branch with no
worktree (hand-pushed/hand-merged, or worktree already retired) is never a
candidate — both `refs/heads/<branch>` and `refs/remotes/origin/<branch>`
survive. Even a merged branch that still has a worktree loses only
`refs/heads/<branch>` (`git branch -D`, cleanup.ts:701); the remote-tracking
prune (`pruneStaleOriginRemoteTrackingRef`, cleanup.ts:968) is reachable only
via `--abandon` / re-run stale-reset. The gap is real; proceed.

## Behavior

- Cleanup enumerates local branches independent of worktrees and prunes
  `refs/heads/<branch>` + `refs/remotes/origin/<branch>` for branches whose PR
  is merged. Rules out leaving merged dead refs that mislead later
  materialization.
- Branches with an open PR left untouched. Rules out deleting in-flight work.
- Unmerged branches with no PR left untouched. Rules out deleting unlanded local work.
- Each pruned ref reported in cleanup output. Rules out undiagnosable silent deletion.

## Prerequisites

- `jarvis cleanup` retires merged worktrees and deletes their local branches
- Cleanup resolves a branch's PR state via `gh`
- Cleanup deletes `refs/remotes/origin/<branch>` on the abandon/re-run path (reusable prune primitive)

## Documentation updates

- `v2/docs/operator-runbook.md` — what `jarvis cleanup` now prunes and what it deliberately keeps.
- `v2/docs/v1-behaviors.md` — cleanup's branch-deletion scope (now worktree-independent for merged branches).

## Sequencing

Same remote-tracking-ref seam as
[[stale-remote-tracking-ref-no-longer-resolves-branch]]. Plan this last, against
that intent's merged result.
