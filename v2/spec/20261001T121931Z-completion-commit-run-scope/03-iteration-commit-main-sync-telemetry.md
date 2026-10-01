# Iteration commit logs main-sync reverts

## Problem

Operators cannot see which paths the harness stripped during an iteration checkpoint without reading git history; the write loop already emits `iteration_commit` for every settled iteration (`log-stream.ts`, `checkpointSettledIteration` in `write-loop.ts`).

## Decision ledger

- Extend `IterationCommitEvent` in `log-stream.ts` so committed iterations may carry optional `mainSyncRevertedPaths: string[]` when non-empty; skip field on skip-reason variants; rules out a new event kind for the same fact.
- Thread `mainSyncRevertedPaths` from `createCompletionCommitter` through `commitSettledIteration` / `checkpointSettledIteration` into the log append; rules out logging only on terminal completion commits.
- Depends on [01-completion-commit-main-sync-refusal.md](./01-completion-commit-main-sync-refusal.md) for the committer result field.

## Task checklist

- Plumb optional `mainSyncRevertedPaths` on the commit outcome type used between committer and log sink.
- Add `write-loop.test.ts` coverage with a stub committer returning non-empty `mainSyncRevertedPaths` and assert the `iteration_commit` event includes them.

## Acceptance criteria

- [x] `v2/src/execution/write-loop.test.ts`: an iteration whose committer returns `mainSyncRevertedPaths` logs them on `iteration_commit`; fails pre-fix.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/operator-practices.md` — `mainSyncRevertedPaths` on `iteration_commit` is the harness signal for stripped main-sync paths; diffing a lane against its merge base before merge remains a manual sanity check.
