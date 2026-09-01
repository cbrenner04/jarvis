---
name: dedupe-execution-loop-cruft
---

# Deduplicate execution-loop helpers, scoped-test types, and dead commit flags

## Primary implementation surface

Execution loop

## Prerequisites

- State store opens a fresh database and upgrades the operator's pre-squash database to the baselined schema without data loss.
- Default SQLite store path is exported from `paths.ts` and persistence call sites no longer re-derive it inline.
- Persistence-layer `isRecord` and shrink-suffix checks import from canonical shared homes.
- Daemon `isLoadError`, `sleep`, `errorMessage`, and `isRecord` import from canonical homes with no local copies under `v2/src/daemon/` or `v2/src/ipc/`.
- Daemon hidden-shrink resume uses shared shrink suffix helpers instead of raw literals or magic slice lengths.
- CLI predicate helpers and `resolveTargetDir` import from canonical homes with no local copies under `v2/src/commands/` or `v2/src/config/`.
- CLI `cleanup.ts` worktree paths use the `paths.ts` worktree-layout helper.

## Problem

Execution-loop code carries the bulk of duplicated helpers (`throwIfAborted`, recursive markdown walkers, `sleep`/`errorMessage`/`resolveTargetDir`, five `isRecord`/`isLoadError` sites), 89 inline error coercions, three near-copied scoped-test runners whose `scope` parameter silently accepts the wrong list shape, six hand-rolled worktree layout derivations, shrink constants split across `workflow-runner.ts`, and a `forceDistinctCommit` flag that is always true leaving `shouldReuseHeadWithoutNewCommit` production-unreachable.

## Behavior

- Consolidate remaining inventoried helper families into one shared or v2 util home each; migrate all execution-loop, TUI, and straggler call sites; grep confirms absence of local duplicate definitions per family.
- Give file-pattern scoped tests and script-name scoped tests distinct parameter types so passing the wrong list fails typecheck.
- Deduplicate the three shared helpers copied across `uncovered-changed-lines.ts`, `diff-derived-mutation-verifier.ts`, and `mutation-checkpoint-verifier.ts`.
- Migrate remaining production worktree derivations (`external-worktree.ts`, `publication-workflow-steps.ts`, and peers) to `paths.ts`.
- Unify shrink step-id suffix usage in `workflow-runner.ts` with the exported constant and helpers.
- Delete `forceDistinctCommit`, the production-unreachable `shouldReuseHeadWithoutNewCommit` reuse branch, and tests that only cover removed behavior.
- Replace inline `error instanceof Error ? … : String(…)` coercions in execution-loop files with the canonical `errorMessage` helper.

## Decision ledger

- Scoped-test `scope` args get distinct types for file patterns vs script names; rules out the silent-pass trap when the wrong list shape is passed.
- `forceDistinctCommit` and its dead branch are deleted outright; rules out a flag with one production value.
- Behavior-preserving: completion-commit production paths stay byte-identical; rules out changing when iteration materialization commits vs reuses HEAD.
- Shared-helper placement follows `shared/` for version-agnostic predicates and v2 util modules for execution-only seams; rules out new duplicate homes.

## Acceptance criteria

- [ ] `v2/src/execution/completion-commit.test.ts` production-path commit pins stay green after `forceDistinctCommit` removal.
- [ ] A typecheck-only regression proves `defaultRunTests` and `defaultRunScopedTests` (or their seam replacements) reject each other's scope list shape at compile time.
- [ ] Grep finds no local definitions for inventoried duplicate families (`isRecord`, `isLoadError`, `throwIfAborted`, recursive markdown walker, `sleep`, `errorMessage`, `resolveTargetDir`) under `v2/src/execution/` or `v2/src/tui/`; the three scoped-test helper copies are reduced to one implementation per helper.
- [ ] Grep finds no `forceDistinctCommit` symbol and no hand-rolled `join(.*"worktrees"` in production execution-loop paths outside `paths.ts`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/coding-standards.md` — document canonical shared-helper homes and the scoped-test scope-type distinction.
