# 00 - Move completed specs during cleanup

## Problem

`jarvis cleanup` currently removes local worktrees and branches whose PRs have been merged, but the corresponding spec tree remains in `spec/`. Completed specs are already conventionally archived under `spec/completed/`, so cleanup should perform that archival step when it removes the worktree for a completed run.

## Scope and decisions

- Apply the move only when `jarvis cleanup` actually removes a worktree. `jarvis cleanup --dry-run` must preview without moving files.
- Move the spec tree associated with the removed worktree from `spec/<name>/` to `spec/completed/<name>/`.
- For patch-mode worktrees, `<name>` is the worktree directory and branch name, matching `.worktree/<name>/`.
- For plan-mode worktrees, `<name>` is the plan spec name from `.worktree/plan-<name>/` / `plan/<name>`, so the source is `spec/<name>/` and the destination is `spec/completed/<name>/`.
- If the source spec directory is missing, cleanup should still remove the merged worktree and branch, and should print a short informational message rather than failing.
- If the destination already exists, cleanup must not overwrite it. It should remove the worktree and branch, leave the source spec in place, print a warning, and return a non-zero exit code so the user can resolve the archive collision manually.
- Keep cleanup limited to specs under the project root's `spec/` directory. Do not move arbitrary paths from worktree metadata.

## Task Checklist

- [ ] Update `cleanupCommand` to derive the spec source and completed destination for each removable patch-mode and plan-mode worktree.
- [ ] After successful worktree and branch removal, move the spec directory to `spec/completed/` when the source exists and the destination is free.
- [ ] Preserve existing merged-PR, dirty-status, confirmation, and `--dry-run` behavior.
- [ ] Add focused tests for patch-mode spec archival, plan-mode spec archival, dry-run non-mutation, missing source handling, and destination collision handling.
- [ ] Update cleanup documentation to describe the spec archival behavior and any manual collision recovery.

## Acceptance criteria

- [ ] `jarvis cleanup` moves `spec/<name>/` to `spec/completed/<name>/` after removing a merged patch-mode worktree for branch `<name>`.
- [ ] `jarvis cleanup` moves `spec/<name>/` to `spec/completed/<name>/` after removing a merged plan-mode worktree for branch `plan/<name>` and directory `.worktree/plan-<name>/`.
- [ ] `jarvis cleanup --dry-run` lists removable worktrees but does not move any spec directories.
- [ ] Cleanup still removes the merged worktree and branch when the matching `spec/<name>/` directory is absent, and it reports that no spec directory was moved.
- [ ] Cleanup does not overwrite an existing `spec/completed/<name>/`; the source spec remains in place, the collision is reported, and the command exits non-zero after completing the worktree and branch removal attempt.
- [ ] Existing cleanup safety gates remain intact: unmerged PRs are ignored, dirty worktrees are skipped, and confirmation is still required outside `--dry-run`.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Documentation updates

- Update `README.md` and/or `docs/worktrees-and-commits.md` cleanup documentation to mention that successful cleanup archives the matching spec directory under `spec/completed/`.
- Update `docs/plan-mode.md` if plan-mode cleanup wording needs to call out the `spec/<name>/` to `spec/completed/<name>/` move for `plan/<name>` branches.
