---
name: completion-commit-run-scope
---

# Harness commits refuse main-sync content

## Problem

Lane worktrees diff against the moving `baseRef` (`main`), not the lane's merge base, so work that landed on `main` after the fork reads as a lane revert. Agents then "restore" those paths from `main`, and `createCompletionCommitter` (`git add -A`) commits them. Evidence 2026-09-30:

- `d39f5071c` (shrink): `shrinkPromptPlaceholders` (`v2/src/execution/workflow-runner.ts`) builds ALLOWLIST/BRANCH_DIFF/RUN_SCOPED_DIFF with two-dot `git diff <baseRef>`; #4268 landed after the fork, so the agent "restored pipeline `supersede` sources, docs, and spec from `origin/main`" (its own summary). 9 paths, blobs equal to `main` tip.
- `bf1e5cbc6` (write, iteration-timeout checkpoint): 32 paths outside the lane's work, each changed on `main` between merge base `d81dcaa9e` and `92144757f` and committed at that tip's content (incl. 3 new seeds `main` later deleted; PR #4286 would have resurrected them).
- `658c18963` (ready-gate repair, unrelated flaky test): the attributable-allowset hole, closed by #4328; out of scope here.

## Decisions

- Shared code goes in new `v2/src/execution/main-sync-scope.ts` (imports only `shared/*`; imported by `completion-commit.ts` and `workflow-runner.ts`, so no cycle through `write-loop.ts`): `resolveLaneMergeBase(worktreePath, baseRef, runner)` (`git merge-base <baseRef> HEAD`) and a pure `selectMainSyncPaths` over per-path blob ids.
- Main-sync rule, per path staged in `preparePendingCommit`'s temp index that differs from `HEAD`: refuse when `HEAD` blob equals merge-base blob (lane never changed it), the staged blob differs from merge-base, and the staged blob equals the path's blob at the tip of `baseRef` or of `origin/<baseRef>` when that resolves. "Absent" is a blob value, so adds and deletes are covered. No path allowset: lane edits, new lane files, and paths the lane already changed are untouched.
- Refused paths are reset to `HEAD` in the temp index and the worktree (removed when absent at `HEAD`); `CompletionCommitResult` returns them as `mainSyncRevertedPaths`. A tree left equal to `HEAD` settles through the existing no-new-commit path. Applies to every committer caller (write, shrink, resume, ready-gate).
- No merge base (unrelated history, missing ref): skip the check, never fail the commit.
- `shrinkPromptPlaceholders` and its `changedFiles` diff against `resolveLaneMergeBase` instead of `baseRef`.
- The write-loop `iteration_commit` event (`v2/src/persistence/log-stream.ts`) carries `mainSyncRevertedPaths` when non-empty.

## Acceptance criteria

- [ ] `v2/src/execution/completion-commit.test.ts` (real git): lane forked at B, `main` then edits X, adds W, deletes Z; worktree mirrors all three plus a lane edit to Y. Commit contains only Y; X, W, Z match `HEAD` in the worktree; `mainSyncRevertedPaths` names X, W, Z. Fails pre-fix (all four committed).
- [ ] Same file: X synced from `origin/main` while local `main` still points at B is refused; fails pre-fix.
- [ ] Same file: a lane edit to X that differs from `main` tip, and a path the lane changed before `main` advanced, both commit unchanged; worktree with only main-sync paths creates no commit.
- [ ] `v2/src/execution/main-sync-scope.test.ts`: `selectMainSyncPaths` truth table (each of the three conditions false keeps the path) and `resolveLaneMergeBase` returning undefined on unrelated history.
- [ ] `v2/src/execution/workflow-runner-shrink-placeholders.test.ts` (real git, exported `shrinkPromptPlaceholders`): a path changed only on `main` after the fork is absent from ALLOWLIST, BRANCH_DIFF, and RUN_SCOPED_DIFF; fails pre-fix.
- [ ] `v2/src/execution/write-loop.test.ts`: an iteration whose committer returns `mainSyncRevertedPaths` logs them on `iteration_commit`; fails pre-fix.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — main-sync refusal on every harness commit; shrink diffs against the merge base.
- `v2/docs/v1-behaviors.md` — catalog both as v2 additive.
- `v2/docs/operator-practices.md` — `mainSyncRevertedPaths` on `iteration_commit` is the signal; diffing a lane against its merge base before merge stays a sanity check.

## Prerequisites
