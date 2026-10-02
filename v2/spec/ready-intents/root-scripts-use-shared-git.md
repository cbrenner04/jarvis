---
name: root-scripts-use-shared-git
---

# Root scripts delegate Git operations to shared boundary

## Problem

Root scripts (`scripts/ready.ts`) construct Git commands directly: `git rev-parse --absolute-git-dir` for resolving the git directory in worktrees. This is a bypass of the shared boundary and duplicates git-knowledge. Scripts should use a shared operation or helper to resolve Git-related paths and state.

## Decisions

- Root scripts import and call Git operations from `shared/git.ts` rather than constructing commands directly.
- A new `gitDir` operation is added to `shared/git.ts` that resolves the correct git directory path (absolute, respecting worktree .git file indirection).
- Script fixtures (for test injection) use explicit runner injection rather than ambient machine Git configuration.
- Plan must decide: which other scripts need Git operations, whether gitDir should cache results or be stateless, how fixtures inject test runners for script testing.

## Prerequisites

- `shared/git.ts` offers consolidated Git operation boundary (delivered by: shared-git-operations-boundary)

## Acceptance criteria

- [ ] `shared/git.ts` exports a `gitDir` operation that resolves the absolute git directory path, respecting worktree indirection.
- [ ] `scripts/ready.ts` calls `gitDir` instead of invoking `git rev-parse --absolute-git-dir` directly.
- [ ] `ready.ts` test fixtures inject a test runner to `gitDir`; test verifies the correct Git command is called.
- [ ] Other root scripts that use Git state/paths also delegate to `shared/git.ts` operations.
- [ ] `bun run typecheck` and `bun run test` (root tooling tests) pass.

## Documentation updates

- `AGENTS.md` — note that root scripts use `shared/git.ts` operations and must not construct Git commands directly.

## Primary implementation surface

- `shared/git.ts` (add gitDir and any other script-level operations)
- `scripts/ready.ts` (migrate to use shared operations)
- `scripts/*.test.ts` (verify fixture injection)
