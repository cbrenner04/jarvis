# Completion commit run-scope allowset and violations

## Problem

`preparePendingCommit` and `restagePendingTreeAfterStrictFormat` (`v2/src/execution/completion-commit.ts`) call `completionStageArgs` (`git add -A` minus harness sidecars) with no post-stage allowset; pending-json retry commits `commit-tree` from stored `pending.tree` without re-running enforcement (`completion-commit.ts` pending path ~408–454), so any dirty path in the worktree can land in shrink, write checkpoint/completion, resume recovery, and ready-gate repair re-commits.

## Decisions

- Run-scope enforcement lives in one shared helper invoked from `createCompletionCommitter` on every index tree that will be committed: after `completionStageArgs` in `preparePendingCommit` and `restagePendingTreeAfterStrictFormat`, and again on the isolated index rebuilt from stored `pending.tree` before `commit-tree` / `shouldReuseHeadWithoutNewCommit` — rules out enforcing only on the first `completionStageArgs` while pending retry or strict restage bypass scope.
- Enforcement order on the isolated `GIT_INDEX_FILE` index: run-scope allowset (this subspec), then [01-stale-main-blob-refusal.md](01-stale-main-blob-refusal.md) stale-main pass, then `write-tree` and empty-remainder / `shouldReuseHeadWithoutNewCommit` handling — rules out treating a scope-violating staged tree as no-progress before reverts run.
- Allowset resolution: `deriveGateAllowedPaths` on `{ worktreePath, baseRef, specPath }` with the same git seam bundle ready-gate repair uses (`REPAIR_FENCE_ALLOWSET_SEAMS` or an extracted shared export); when `deriveGateAllowedPaths` returns `{ reason }`, fail closed like `initializeFrozenRepairAllowset` (`completion_commit_failed` + `ready_gate_fence_derivation_failed` on `logSink` when provided) — rules out revert+log continuation when derivation cannot run.
- Co-located test admission: apply `admitCoLocatedTestsOfAllowedPaths` to the derived set when the commit is not markdown-only; when `CompletionCommitInput` carries the same markdown-only + markdown output-root hints `initializeFrozenRepairAllowset` reads from write-loop (`promptId`, `landing`, `expectedArtifactPath`, `specPath`), use derived paths only (no co-located expansion) — rules out inferring markdown-only from ambient machine config on runner/resume call sites that omit hints (those call sites default to non-markdown-only admission).
- Repair-fence allowset: when the active run row has a persisted `readyGateRepairFence` allowset, load it via `loadPersistedRepairAllowset` (or shared export); when `loadPersistedRepairAllowset` returns `"corrupt"`, fail closed like `readyGateRepairProvenanceFailure` — rules out reverting+log when repair provenance is corrupt. When a persisted fence allowset is present, it alone is the enforcement allowset (fence wins over a fresh `deriveGateAllowedPaths` pass). When `shouldEnforceReadyGateRepairFence` is true and no fence is persisted yet, derive through `initializeFrozenRepairAllowset` — rules out calling `initializeFrozenRepairAllowset` on ordinary write/shrink/checkpoint commits where repair-fence enforcement is off and rules out union-widening a frozen fence with a fresh derive pass.
- Out-of-scope staged paths: restore each to `HEAD` in the worktree (tracked revert; delete untracked additions), drop from the isolated index, append `{ kind: "commit_scope_violation", paths: string[] }` when both `logSink` and `runId` are on `CompletionCommitInput`, then continue on the in-scope remainder — rules out failing the whole commit on the first violation, leaving refused paths dirty, and implying always-on logging without `logSink`+`runId`.
- When the scoped index tree equals `HEAD^{tree}` after enforcement, treat as no new commit material (`shouldReuseHeadWithoutNewCommit` / empty `commitSha` semantics callers already use); do not report a successful new completion commit — rules out an empty marker commit counting as progress.
- Thread `runId`, `logSink`, `integrationMainRef` (01), store access or a pre-resolved allowset, and markdown-scope hints through `CompletionCommitInput` from write-loop, workflow-runner, and workflow-runner-resume harness-commit call sites; unit tests may pass an explicit allowset fixture without a store — rules out reading ambient `~/.jarvis` state inside the committer.

## Tasks

- Factor or export allowset resolution shared with `initializeFrozenRepairAllowset` / `loadPersistedRepairAllowset` without changing ready-gate repair semantics.
- Implement shared post-stage enforcement on the isolated index and matching worktree reverts; wire it into `preparePendingCommit`, `restagePendingTreeAfterStrictFormat`, and the pending-json `pending.tree` commit leg.
- Extend `CompletionCommitInput` and harness commit call sites.
- Add `completion-commit.test.ts` coverage for mixed in-scope / out-of-scope staging, log emission, pending-json retry leg, and strict-restage leg.

## Acceptance criteria

- [ ] `v2/src/execution/completion-commit.test.ts` drives a real-git worktree with one in-scope edit and one file the run never touched; the resulting commit contains only the in-scope path, the other path is clean at `HEAD`, and the test observes `commit_scope_violation` naming the refused path when `logSink` and `runId` are provided; it fails against the pre-fix `add -A` staging reachable in `completion-commit.ts`.
- [ ] `v2/src/execution/completion-commit.test.ts` drives a pending-json retry commit (`jarvis-completion-pending.json` with stored `tree`, no fresh `preparePendingCommit`) with an out-of-scope path present only on that tree; enforcement reverts it before `commit-tree`; it fails against the pre-fix pending leg in `completion-commit.ts` that commits `pending.tree` without re-enforcement.
- [ ] `v2/src/execution/completion-commit.test.ts` drives `restagePendingTreeAfterStrictFormat` (checkpoint pending upgraded to strict) with an out-of-scope dirty path; the upgraded tree excludes it; it fails against the pre-fix restage path that only re-runs `completionStageArgs`.
- [ ] `v2/src/execution/completion-commit.test.ts` asserts `deriveGateAllowedPaths` returning `{ reason }` yields `completion_commit_failed` (and `ready_gate_fence_derivation_failed` when `logSink` is wired), matching pre-fix `initializeFrozenRepairAllowset` fail-closed behavior; it fails against a committer that skips derivation failure handling.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- Deferred to [03-documentation-alignment.md](03-documentation-alignment.md).
