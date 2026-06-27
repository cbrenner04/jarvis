---
name: cleanup-retires-abandoned-runs
---

# Retire abandoned runs (unmerged, closed/none PR) in one command

## Behavior

Give run abandonment a jarvis command instead of the manual
`gh pr close` + `git worktree remove --force` + `git branch -D` +
`git push origin --delete` sequence.

For a worktree whose PR is closed or absent and **unmerged**, the command:

- closes the still-open draft PR if one exists,
- removes the worktree even when contaminated/dirty (force; a red run is dirty
  by nature, unlike merged-cleanup which skips dirty worktrees),
- deletes the local branch and the remote branch,
- leaves the **source spec intact** so `jarvis1 run` re-runs the same spec cleanly.

Dry-run previews exactly which worktrees would be retired. The result is a
deterministic clean slate: no closed-PR branch blocking a fresh draft PR, no
orphan worktree colliding on re-run.

Operator judgment over *which* runs to abandon stays out of scope; archiving
completed specs stays in the existing merged-cleanup path.

## Prerequisites

- jarvis1 cleanup removes worktrees whose PR merged and archives their spec
