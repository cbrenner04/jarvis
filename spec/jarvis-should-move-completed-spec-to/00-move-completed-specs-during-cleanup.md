# 00 - Move completed specs during cleanup

## Problem

`jarvis cleanup` currently removes local worktrees and branches whose PRs have been merged, but the corresponding spec tree remains in `spec/`. Completed specs are already conventionally archived under `spec/completed/`, so cleanup should perform that archival step when it removes the worktree for a completed run.

## Scope and decisions

- The archive step is part of `jarvis cleanup`, not a separate command.
- `jarvis cleanup --dry-run` must remain read-only. It may mention the spec archive that would be attempted, but it must not create, move, or delete spec directories.
- Archive only after the corresponding worktree and local branch removal succeed. If either removal fails for an item, do not move that item's spec directory.
- Move the spec tree from `spec/<name>/` to `spec/completed/<name>/` in the project root checkout. This is a local git working-tree change; `jarvis cleanup` does not commit it.
- For patch-mode worktrees, derive `<name>` from the worktree directory name and branch name used by existing cleanup behavior: `.worktree/<name>/` on branch `<name>`.
- For plan-mode worktrees, derive `<name>` from `.worktree/plan-<name>/` on branch `plan/<name>`. The archive source is still `spec/<name>/`, not `spec/plan-<name>/`.
- Keep archival paths constrained to direct children of the project root's `spec/` and `spec/completed/` directories. Do not read a spec path from worktree contents, PR metadata, or any agent-written file.
- If the source spec directory is missing, cleanup should still remove the merged worktree and branch, print a short informational message that no spec directory was moved, and continue.
- If `spec/completed/<name>/` already exists, cleanup must not overwrite it. It should still remove the merged worktree and branch, leave `spec/<name>/` in place, print a warning that names both paths, continue processing other removable worktrees, and return a non-zero exit code at the end.
- If an archive move fails for any other filesystem reason, report the failure, keep processing remaining removable worktrees where possible, and return a non-zero exit code.
- Preserve existing cleanup safety gates: only merged PRs are considered, dirty worktrees are skipped, and interactive confirmation is required unless `--dry-run` is set.

## Task Checklist

- [ ] Update `cleanupCommand` to derive the spec source and completed destination for each removable patch-mode and plan-mode worktree without reading paths from worktree metadata.
- [ ] After successful worktree and branch removal for an item, move its spec directory to `spec/completed/` when the source exists and the destination is free.
- [ ] Report missing source directories, destination collisions, and archive move failures with actionable messages.
- [ ] Accumulate archive failures so cleanup can continue processing other removable worktrees while still returning non-zero when any archive fails.
- [ ] Preserve existing merged-PR, dirty-status, confirmation, and `--dry-run` behavior.
- [ ] Add focused tests for patch-mode archival, plan-mode archival, dry-run non-mutation, missing source handling, destination collision handling, removal failure ordering, and multi-worktree continuation after an archive failure.
- [ ] Update cleanup documentation to describe spec archival, the uncommitted local move, and manual collision recovery.

## Acceptance criteria

- [ ] After confirmation, `jarvis cleanup` removes a merged patch-mode worktree for `.worktree/<name>/` on branch `<name>` and moves `spec/<name>/` to `spec/completed/<name>/`.
- [ ] After confirmation, `jarvis cleanup` removes a merged plan-mode worktree for `.worktree/plan-<name>/` on branch `plan/<name>` and moves `spec/<name>/` to `spec/completed/<name>/`.
- [ ] `jarvis cleanup --dry-run` lists removable worktrees but does not move, create, or delete any spec directories.
- [ ] If worktree or branch removal fails for an item, cleanup reports that removal failure and does not move that item's spec directory.
- [ ] Cleanup still removes the merged worktree and branch when the matching `spec/<name>/` directory is absent, reports that no spec directory was moved, and exits zero if no other cleanup step failed.
- [ ] Cleanup does not overwrite an existing `spec/completed/<name>/`; the source spec remains in place, the collision is reported with both source and destination paths, cleanup continues with any remaining removable worktrees, and the command exits non-zero.
- [ ] Cleanup returns non-zero when any archive move fails, while preserving successful removals and successful archive moves for other items processed in the same run.
- [ ] Existing cleanup safety gates remain intact: unmerged PRs are ignored, dirty worktrees are skipped, and confirmation is still required outside `--dry-run`.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Documentation updates

- Update `README.md` and/or `docs/worktrees-and-commits.md` cleanup documentation to mention that successful cleanup archives the matching spec directory under `spec/completed/` as an uncommitted local file move.
- Document that archive collisions leave `spec/<name>/` in place, remove the completed worktree and branch, and require manual resolution before rerunning or committing the cleanup.
- Update `docs/plan-mode.md` if plan-mode cleanup wording needs to call out the `spec/<name>/` to `spec/completed/<name>/` move for `plan/<name>` branches.
