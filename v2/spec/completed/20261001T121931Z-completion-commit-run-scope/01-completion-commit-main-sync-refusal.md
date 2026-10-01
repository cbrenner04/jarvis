# Completion commit main-sync refusal

## Problem

`preparePendingCommit` stages the full worktree with `git add -A` semantics, so agent "restores" from `main` after the fork become durable commits even when the lane never changed those paths at `HEAD` (reachable on main via commits `d39f5071c`, `bf1e5cbc6` cited in intent).

## Decision ledger

- After staging into the temp index in `preparePendingCommit` and again in `restagePendingTreeAfterStrictFormat`, run main-sync selection using blobs at `HEAD`, merge base, staged index, `baseRef` tip, and `origin/<baseRef>` when that ref resolves; rules out checking only local `baseRef` when the agent synced from `origin/main`.
- When `resolveLaneMergeBase` returns `undefined`, skip refusal entirely; rules out failing completion when merge-base is unavailable.
- For each refused path, reset the temp index and worktree to `HEAD` (remove worktree file when absent at `HEAD`); rules out leaving refused content in the worktree while committing a subset.
- Extend `CompletionCommitResult` with optional `mainSyncRevertedPaths: string[]` (sorted, repo-relative); export the result type if `write-loop.ts` must read the field; rules out a side channel or log-only signal inside the committer.
- Applies to every `createCompletionCommitter` caller without per-caller opt-out; rules out write-only enforcement that leaves shrink/resume/ready-gate paths able to commit main-sync blobs.
- When refusal leaves the pending tree equal to `HEAD`, reuse existing `shouldReuseHeadWithoutNewCommit` / empty settled result behavior; rules out inventing a new skip reason for "only main-sync dirt".

## Task checklist

- Wire blob collection and `selectMainSyncPaths` into `completion-commit.ts` after index staging, before `write-tree`, sharing one helper between prepare and strict-restage paths.
- Add real-git cases to `completion-commit.test.ts` covering forked lane vs advanced `main`, `origin/main` ahead of local `baseRef`, lane-owned edits, pre-fork lane changes, and worktree with only main-sync paths (no new commit).

## Acceptance criteria

- [x] `v2/src/execution/completion-commit.test.ts` (real git): lane forked at B, `main` then edits X, adds W, deletes Z; worktree mirrors all three plus a lane edit to Y; commit contains only Y; X, W, Z match `HEAD` in the worktree; `mainSyncRevertedPaths` names X, W, Z; fails pre-fix (all four committed).
- [x] Same file: X synced from `origin/main` while local `main` still points at B is refused; fails pre-fix.
- [x] Same file: a lane edit to X that differs from `main` tip, and a path the lane changed before `main` advanced, both commit unchanged; worktree with only main-sync paths creates no commit.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes for `v2/src/execution/completion-commit.test.ts` and `v2/src/execution/main-sync-scope.test.ts`.

## Documentation updates

- `v2/docs/write-behavior.md` — document main-sync refusal on every harness completion commit (rule, worktree reset, `mainSyncRevertedPaths`, merge-base skip).
- `v2/docs/v1-behaviors.md` — **[v2 behavior change]** catalog completion commit refusing main-sync staged paths.
