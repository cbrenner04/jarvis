# Main-sync scope helpers

## Problem

Completion commit and shrink placeholder logic need a shared merge-base anchor and a pure rule for paths whose staged content mirrors `main` after the lane fork without the lane ever having changed them at `HEAD`.

## Decision ledger

- Add `v2/src/execution/main-sync-scope.ts` importing only `shared/*`; rules out placing helpers in `completion-commit.ts` alone or importing `v2/**` from a module that `workflow-runner.ts` and `completion-commit.ts` both import (cycle through `write-loop.ts`).
- `resolveLaneMergeBase(worktreePath, baseRef, runner)` runs `git merge-base <baseRef> HEAD` via the injected async subprocess seam; returns `undefined` when merge-base cannot be resolved (unrelated history, missing ref); rules out throwing or blocking callers when history is unrelated.
- `selectMainSyncPaths` is pure over per-path records carrying `headBlob`, `mergeBaseBlob`, `stagedBlob`, and optional `baseRefTipBlob` / `originBaseRefTipBlob`; a path is selected when all three hold: `headBlob === mergeBaseBlob`, `stagedBlob !== mergeBaseBlob`, and `stagedBlob` equals at least one resolved tip blob; absent paths use a dedicated absent blob sentinel shared by caller and function; rules out path allowlists or filename heuristics.
- Deferred to first consumer: exact TypeScript shape for path records and absent sentinel — pin when `completion-commit.ts` wires blob reads.

## Task checklist

- Implement `main-sync-scope.ts` with exported `resolveLaneMergeBase` and `selectMainSyncPaths`.
- Add `main-sync-scope.test.ts`: truth table proving each false leg of the three-condition conjunction keeps the path out of the result; real-git fixture proving `resolveLaneMergeBase` returns `undefined` on unrelated history.

## Acceptance criteria

- [ ] `v2/src/execution/main-sync-scope.test.ts`: `selectMainSyncPaths` truth table (each of the three conditions false keeps the path) and `resolveLaneMergeBase` returning undefined on unrelated history; fails against the pre-fix code (module absent).
- [ ] `bun run typecheck` passes.

## Documentation updates

- None (internal module; operator-facing behavior lands in sibling subspecs).
