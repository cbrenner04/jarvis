---
name: cleanup-retires-merged-v2-workspaces
---

# Cleanup retires merged v2 workspaces

`jarvis cleanup` discovers merged worktrees under v2's `~/.jarvis/worktrees/<project>/` home, previews the worktree and branch removals with `--dry-run`, prompts `[y/N]`, then removes confirmed worktrees and their local branches. It ignores worktrees owned by open or live runs and never deletes durable run rows.

## Decisions

- Discover v2's external worktree home, not only v1's `<repo>/.worktree/`; rules out leaving the accumulating v2 registrations invisible to cleanup.
- Treat merged PR state plus live ownership as the retirement boundary; rules out deleting a concurrent run's workspace merely because its directory is old.
- Preserve v1's `cleanup`, `--dry-run`, and `[y/N]` operator vocabulary; rules out a second v2-only cleanup command.

## Out of scope

- Spec archival and ready-intent pruning.
- Unmerged or wedged workspace abandonment.
- Durable run-row retention or repair.

## Prerequisites

## Documentation updates

- `v2/docs/operator-runbook.md` — merged-workspace cleanup and safety guards.
- `v2/docs/first-workflow-walkthrough.md` — invoke cleanup at session end.
