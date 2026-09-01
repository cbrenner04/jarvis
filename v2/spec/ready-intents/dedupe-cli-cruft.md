---
name: dedupe-cli-cruft
---

# Deduplicate CLI predicate and path-derivation cruft

## Primary implementation surface

CLI

## Prerequisites

- State store opens a fresh database and upgrades the operator's pre-squash database to the baselined schema without data loss.
- Default SQLite store path is exported from `paths.ts` and persistence call sites no longer re-derive it inline.
- `shared/is-record.ts` exports `isRecord`; `shared/shrink-step-id.ts` exports the hidden-shrink step-id suffix constant and strip/match helpers.

## Problem

CLI admission commands duplicate `isRecord` and `isLoadError` (`init.ts`, `write.ts`, `pipeline-start-admission.ts`), `init.ts` reimplements `errorMessage` and `resolveTargetDir`, `machine-config-loader.ts` carries another `isRecord`, and `cleanup.ts` hand-rolls worktree root layout.

## Behavior

- Migrate CLI and config-loader predicate helpers to the canonical shared homes; delete local definitions.
- Add a `paths.ts` worktree-layout helper and migrate `cleanup.ts` production paths off hand-rolled `join(jarvisRoot, "worktrees", …)`.

## Decision ledger

- Worktree layout `join(root, "worktrees", project, branch)` is derived only through `paths.ts`; rules out re-deriving layout by hand in CLI code.
- `resolveTargetDir` has one implementation consumed by CLI call sites; rules out a second copy in `init.ts`.
- Behavior-preserving: init target-dir resolution and cleanup worktree enumeration stay identical; rules out changing which paths cleanup considers in-scope.

## Acceptance criteria

- [ ] `v2/src/commands/workflow.test.ts` init and cleanup stale-reset pins stay green.
- [ ] Grep finds no local `function isRecord`, `function isLoadError`, `function errorMessage`, or `function resolveTargetDir` under `v2/src/commands/` or `v2/src/config/`.
- [ ] `cleanup.ts` production worktree paths call the `paths.ts` worktree helper; no hand-rolled `join(.*"worktrees"` remains in `v2/src/commands/cleanup.ts`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- None — purely internal helper moves; canonical homes are documented in `squash-state-store-migrations` and `dedupe-execution-loop-cruft` (`v2/docs/coding-standards.md`).
