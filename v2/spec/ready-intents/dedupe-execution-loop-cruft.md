---
name: dedupe-execution-loop-cruft
---

# Deduplicate execution-loop helpers and scoped-test types

## Primary implementation surface

Execution loop

## Prerequisites

- State store opens a fresh database and upgrades the operator's pre-squash database to the baselined schema without data loss.
- Default SQLite store path and worktree-layout helpers are exported from `paths.ts`.
- `shared/is-record.ts` exports `isRecord`; `shared/shrink-step-id.ts` exports the hidden-shrink step-id suffix constant and strip/match helpers.

## Problem

Execution-loop code carries the bulk of duplicated helpers (`throwIfAborted`, recursive markdown walkers, `sleep`/`errorMessage`/`resolveTargetDir`, five `isRecord`/`isLoadError` sites), 89 inline error coercions, two near-copied scoped-test runners whose `scope` parameter silently accepts the wrong list shape, six hand-rolled worktree layout derivations, and shrink constants split across `workflow-runner.ts`.

## Behavior

- Consolidate remaining inventoried helper families into one shared or v2 util home each; migrate execution-loop production paths and any TUI stragglers still carrying inventoried duplicates; grep confirms absence of local duplicate definitions per family.
- Give file-pattern scoped tests and script-name scoped tests distinct parameter types so passing the wrong list fails typecheck.
- Deduplicate the shared helpers copied across `uncovered-changed-lines.ts` and `diff-derived-mutation-verifier.ts`.
- Migrate remaining production worktree derivations (`external-worktree.ts`, `publication-workflow-steps.ts`, and peers) to `paths.ts`.
- Unify shrink step-id suffix usage in `workflow-runner.ts` with imports from `shared/shrink-step-id.ts`.
- Replace inline `error instanceof Error ? … : String(…)` coercions in execution-loop files with the canonical `errorMessage` helper.

## Decision ledger

- Scoped-test `scope` args get distinct types for file patterns vs script names; rules out the silent-pass trap when the wrong list shape is passed.
- Behavior-preserving: completion-commit production paths stay byte-identical; rules out changing when iteration materialization commits vs reuses HEAD.
- Shared-helper placement follows `shared/` for version-agnostic predicates and v2 util modules for execution-only seams; rules out new duplicate homes.

## Acceptance criteria

- [ ] `v2/src/execution/completion-commit.test.ts` production-path commit pins stay green.
- [ ] A typecheck-only regression proves `defaultRunTests` and `defaultRunScopedTests` (or their seam replacements) reject each other's scope list shape at compile time.
- [ ] Grep finds no local definitions for inventoried duplicate families (`isRecord`, `isLoadError`, `throwIfAborted`, recursive markdown walker, `sleep`, `errorMessage`, `resolveTargetDir`) under `v2/src/execution/`; any remaining duplicates under `v2/src/tui/` are migrated; the two scoped-test helper copies are reduced to one implementation per helper.
- [ ] Grep finds no hand-rolled `join(.*"worktrees"` in production execution-loop paths outside `paths.ts`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/coding-standards.md` — document canonical shared-helper homes and the scoped-test scope-type distinction.
