---
name: external-worktree-delegates-to-shared
---

# External worktree operations delegate to shared Git boundary

## Problem

`v2/src/execution/external-worktree.ts` constructs Git worktree and branch commands directly: `git branch`, `git worktree add`, `git rev-parse`, `git worktree list`, `git worktree prune`. These duplicate the worktree operations being centralized in `shared/git.ts` and bypass the canonical boundary. External-worktree should delegate to shared operations, not construct commands inline.

## Decisions

- External-worktree calls typed `shared/git.ts` worktree and branch operations instead of constructing commands directly.
- Signal handling (AbortSignal) is passed through to the operation invocation; operations respect signal cancellation.
- Branch creation (from base or fork ref) delegates to the shared branch creation operation with explicit precedence semantics.
- Plan must decide: whether worktree creation should pre-check that the target branch doesn't exist (optimization vs. letting git fail), which operation errors are fatal vs. recoverable (e.g., branch already exists locally), how to handle signal abort mid-operation.

## Prerequisites

- `shared/git.ts` offers consolidated Git operation boundary (delivered by: shared-git-operations-boundary)

## Acceptance criteria

- [x] `external-worktree.ts` no longer calls `runner.runAsync("git", […])` directly; all Git operations call typed `shared/git.ts` exports.
- [x] `external-worktree.test.ts`: creating a worktree from an origin branch delegates to `createWorktree` with branch existence verification; test injects a mock to verify calls.
- [x] Same file: creating a worktree from a fork ref delegates to the branch creation operation first, then worktree creation.
- [x] Same file: a cancelled operation (AbortSignal) propagates the abort to the Git operation; test verifies signal is passed through.
- [x] `external-worktree.test.ts`: an operation failure (e.g., branch exists locally) is caught and interpreted using documented operation semantics.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/v2-architecture.md` — execution library's Git operations entry point is `shared/git.ts` (not direct runner invocation).

## Primary implementation surface

- `v2/src/execution/external-worktree.ts` (migrate to typed boundaries)
- `v2/src/execution/external-worktree.test.ts` (update to verify delegation)
