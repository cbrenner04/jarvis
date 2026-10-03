---
name: cleanup-delegates-to-git-boundary
---

# Cleanup delegates Git operations to typed boundary

## Problem

`v2/src/commands/cleanup.ts` constructs Git commands directly inline: worktree add/remove/list/prune, branch operations, ref updates, diff. It injects a local `git` runner wrapper that executes arbitrary command arrays without semantic structure, bypassing the canonical boundary and duplicating parsing logic. Moving cleanup to call typed `shared/git.ts` centralizes error semantics and allows reuse.

## Decisions

- Cleanup stops constructing Git command arrays; it calls typed `shared/git.ts` operations instead (diff, worktree, branch, ref mutations).
- Error handling is delegated to the operation owner: cleanup catches and interprets well-defined operation errors from `shared/git.ts`.
- Cleanup delegates GitHub PR operations to the typed GitHub operations boundary via injected interface, not runtime state, to support fixture testing with mock runners.
- Plan must decide: which error cases cleanup must handle vs. propagate, whether cleanup needs additional transient-error retry logic.

## Prerequisites

- `shared/git.ts` offers consolidated Git operation boundary (delivered by: shared-git-operations-boundary)
- Typed GitHub operations boundary exists and supports PR list/view/check merged operations (delivered by: github-operations-boundary)

## Acceptance criteria

- [ ] `cleanup.ts` no longer calls `runner.runAsync("git", […])` directly; all Git operations call typed `shared/git.ts` exports.
- [ ] `cleanup.test.ts`: a cleanup run that retires worktrees delegates to the new `shared/git.ts` worktree operations; test injects a mock to verify calls and return values.
- [ ] Same file: a cleanup run that reads specs from a Git ref delegates to the new diff/show operations.
- [ ] Cleanup PR queries (list merged PRs, check merged state) delegate to the typed GitHub operations boundary with injected runner; test injects mock to verify query structure.
- [ ] `cleanup.test.ts`: error handling for an operation failure (e.g., worktree remove fails) matches documented semantics from the operation owner.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — note that cleanup's error messages now reference the Git operation that failed and its semantics (statefulness, retryability).
- `v2/docs/v1-behaviors.md` — record any cleanup behavior changes (e.g., retry handling, error message formats).

## Primary implementation surface

- `v2/src/commands/cleanup.ts` (migrate to typed boundaries)
- `v2/src/commands/cleanup.test.ts` (update to verify delegation)
