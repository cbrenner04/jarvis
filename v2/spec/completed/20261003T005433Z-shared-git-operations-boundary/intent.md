---
name: shared-git-operations-boundary
---

# Consolidated Git operations boundary in shared/git.ts

## Problem

`shared/git.ts` exports ref queries (branch exists, current branch), but higher-level Git operations (diffs, worktree management, ref mutations, push) are constructed directly in callers: `shared/prompts/review-implement.ts` has `branchDiff`, `v2/src/commands/cleanup.ts` constructs worktree, branch, update-ref, and push commands inline, and `v2/src/execution/external-worktree.ts` constructs worktree operations directly. Centralizing these operations establishes a single owner for command construction, output parsing, and error semantics.

## Decisions

- `shared/git.ts` becomes the single owner of all Git operations for Jarvis-owned code: command construction, output parsing, and documented error cases live there.
- Operations are exposed as typed, deterministic functions; callers pass parsed/semantic arguments, not raw command arrays.
- Diff operations include merge-base computation, unified diff generation, and stat-only diff for review context; error cases distinguish merge-base failure from diff failure.
- Worktree operations (add, remove, list, prune) include idempotency semantics and return structured result types instead of raw output.
- Ref/branch/push mutations (branch create/delete, update-ref, push) document which are stateful, which errors are retryable, and which require precondition checks.
- Add tests that pin parsing, error semantics, and policy; do not test the invocation path (injection of subprocess runner covers that in caller tests).
- Plan must decide: which error cases are fatal vs. transient, idempotency requirements per operation, which operations need fixture injection for testing root scripts, and which additional operation candidates (subprocess lifecycle, workspace/path confinement, gate execution, spec mechanics, run/pipeline admission) demonstrate enough duplication to warrant migration in this or future specs.

## Prerequisites

## Acceptance criteria

- [x] `git.test.ts`: typed diff operations (merge-base, stat, unified) exist with pinned parsing and a distinct merge-base-failure error; fails against current code (no such exports).
- [x] Same file: typed worktree lifecycle operations (add, remove, list, prune) return structured results with pinned idempotency semantics.
- [x] Same file: typed branch, ref, and push mutations distinguish absence from an inconclusive query and name retryable failures; plan must decide the export names.
- [x] `bun run typecheck` and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/v2-architecture.md` — add section on Git operation ownership, canonical boundary, and entry points for `shared/git.ts` operations.
- `AGENTS.md` — note that Git operations have a single owner in `shared/git.ts` and callers must use its exports, not construct commands directly.

## Primary implementation surface

- `shared/git.ts` (new typed operation exports)
- `shared/git.test.ts` (new tests for operations)
