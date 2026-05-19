# Fix hasDirtyStatus upstream error handling

## Problem

`hasDirtyStatus` in `src/commands/cleanup.ts:170–190` wraps both `git status
--porcelain` and `git log @{u}..` in a single try/catch that returns `true` on
any exception. After a PR is merged and the remote branch is deleted, `@{u}` no
longer exists. Git exits non-zero with "fatal: no upstream configured for
branch '...'" — the catch block interprets this as dirty, causing the worktree
to be skipped instead of cleaned up.

## Decisions

- A missing upstream (exception from `git log @{u}..`) means no pending pushes,
  so treat it as `false` — not dirty — for the upstream check.
- An exception from `git status --porcelain` still means we cannot determine
  status, so keep treating it as `true` — assume dirty.
- Split into two separate try/catch blocks; do not change any other logic in
  `hasDirtyStatus` or the rest of `cleanup.ts`.

## Tasks

- [x] In `src/commands/cleanup.ts`, split `hasDirtyStatus` into two independent
  try/catch blocks:
  1. Outer block runs `git status --porcelain`; any exception returns `true`.
  2. Inner block runs `git log @{u}..`; any exception returns `false` (no
     upstream = no unpushed commits); success with output returns `true`.
- [x] In `test/cleanup-command.test.ts`, add a test that:
  1. Calls `createTrackedWorktree(specName)` to create a worktree with an
     upstream tracking ref.
  2. Deletes the remote branch: `git push origin --delete <specName>` run from
     `projectRoot`.
  3. Runs `cleanupCommand` with `isMergedPr: () => true`.
  4. Asserts the worktree path no longer exists and the output does not contain
     "uncommitted or unpushed changes".

## Acceptance criteria

- [x] `hasDirtyStatus` returns `false` for a worktree whose remote tracking
  branch has been deleted (upstream ref gone), allowing cleanup to proceed.
- [x] `hasDirtyStatus` still returns `true` for a worktree with uncommitted
  changes (existing `git status --porcelain` behaviour unchanged).
- [x] `hasDirtyStatus` still returns `true` for a worktree with commits not yet
  pushed (existing `git log @{u}..` behaviour when upstream exists unchanged).
- [x] The new test passes: a worktree whose upstream has been deleted is cleaned
  up (path removed) and the output does not mention "uncommitted or unpushed
  changes".
- [x] All existing tests in `test/cleanup-command.test.ts` continue to pass.
