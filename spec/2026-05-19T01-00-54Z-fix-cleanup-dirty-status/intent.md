---
name: fix-cleanup-dirty-status
---
i think we broke cleanup

```text
$ jarvis cleanup
skipping 2026-05-18T20-57-30Z-plan-project-config-not-applied: has uncommitted or unpushed changes
skipping 2026-05-18T19-57-30Z-checks-before-pr-ready: has uncommitted or unpushed changes
no merged worktrees to remove
```

## Refine turn 1

### Root cause

`hasDirtyStatus` in `src/commands/cleanup.ts` returns `true` when `git log @{u}..` throws an error. After a PR is merged and the remote branch deleted, `@{u}` (the upstream tracking ref) no longer exists. Git exits non-zero with "fatal: no upstream configured for branch '...'" — which the broad `catch { return true }` misinterprets as "dirty", causing the worktree to be skipped instead of cleaned up.

The `git status --porcelain` step passes (no uncommitted changes), but the upstream check throws, and the single try/catch treats any exception as dirty.

### Fix

Split the dirty-status check into two independent operations with separate error handling:

1. `git status --porcelain` — any error → `true` (can't determine status, assume dirty)
2. `git log @{u}..` — if it throws (no upstream configured), treat as `false` (no pending pushes); only return `true` when the command succeeds AND has output

A missing upstream is expected after a remote branch is deleted post-merge, and should not block cleanup.

### Secondary observation: spec directory archiving with timestamped worktrees

The worktrees on disk are named `2026-05-18T19-57-30Z-checks-before-pr-ready` (not `plan-checks-before-pr-ready`). The `specNameForBranch` function strips the `plan/` prefix from the branch name to produce a spec name, then looks for `spec/<specName>`. But with timestamp-prefixed spec directories (e.g. `spec/2026-05-18T...Z-checks-before-pr-ready/`), the un-prefixed lookup will miss. This may be a separate pre-existing issue; the immediate bug blocking cleanup is the `@{u}` error handling.

### Scope

- Fix: `src/commands/cleanup.ts` — `hasDirtyStatus` function only
- Test: add a test case in `test/cleanup-command.test.ts` that creates a tracked worktree whose upstream has been deleted (simulating the merged-and-branch-deleted state) and verifies the worktree is cleaned up rather than skipped
- Do not change `isMergedPr`, worktree naming, or spec archiving logic in this fix

## Refine turn 2

### Code confirmation

`hasDirtyStatus` at `src/commands/cleanup.ts:170–190` is exactly as described. The single `try/catch` wraps both `git status --porcelain` and `git log @{u}..`, so any exception from either returns `true`. The fix is a two-block split: keep the outer try/catch for the porcelain check (error → `true`), then a separate try/catch for the upstream check (exception → `false`, success-with-output → `true`).

### Test pattern

The existing `createTrackedWorktree` helper already pushes with `-u origin`, establishing the tracking ref. To reproduce the bug in a test:

1. Call `createTrackedWorktree(specName)` to create the tracked worktree.
2. Delete the remote branch from the bare remote: `git push origin --delete <specName>` (run from `projectRoot`).
3. Run `cleanupCommand` with `isMergedPr: () => true`.
4. Assert the worktree was cleaned up (path no longer exists) rather than skipped, and that output does not contain "uncommitted or unpushed changes".

The bare `remote.git` used in the test setup makes `git push origin --delete` work without a real remote, so this approach is self-contained within the existing test infrastructure.

### No additional scope changes

The secondary `specNameForBranch` / timestamped-directory mismatch is a real issue (the user's worktrees have timestamp prefixes that wouldn't be found) but intentionally deferred from this fix. If it needs addressing it should be a separate spec.

## Refine skip

Code and test infrastructure confirmed. The intent is complete and accurate; no further refinement needed.
