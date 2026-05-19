# 00 - Force-delete locally unmerged branches after merged PR confirmation

`jarvis cleanup` discovers worktrees whose GitHub PR is merged, confirms with the
user, removes the worktree, then runs `git branch -d <branch>`. That safe delete
fails for common squash-merge and rebase-merge workflows because the local branch
commit is not reachable from local `main` even though GitHub has already merged
the PR.

The cleanup command should complete after the existing safety gates pass:
GitHub reports the PR merged, the worktree is clean, cleanup did not detect
unpushed commits, and the user confirmed removal.

## Task checklist

- Update `src/commands/cleanup.ts` so branch deletion handles merged PR branches
  whose commits are not reachable from local `main`.
- Add a regression test for a pushed branch commit that is not merged into local
  `main`, matching squash/rebase-style cleanup.
- Update cleanup documentation to describe the local branch deletion behavior.

## Acceptance criteria

- [x] `jarvis cleanup` removes a confirmed merged worktree and its local branch
  when `git branch -d` would reject the branch as not fully merged.
- [x] Existing cleanup safety gates still run before branch force-deletion:
  merged PR check, dirty-worktree check, unpushed-commit check where an upstream
  exists, and interactive confirmation.
- [x] `test/cleanup-command.test.ts` covers the locally-unmerged branch case.
- [x] Cleanup docs mention that confirmed merged PR branches may be force-deleted
  locally after the existing gates pass.
- [x] `bun run typecheck` passes.
- [x] `bun test` passes.
