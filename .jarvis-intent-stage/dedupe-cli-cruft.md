---
name: dedupe-cli-cruft
---

# Deduplicate CLI predicate and path-derivation cruft

## Primary implementation surface

CLI

## Prerequisites

- State store opens a fresh database and upgrades the operator's pre-squash database to the baselined schema without data loss.
- Default SQLite store path is exported from `paths.ts` and persistence call sites no longer re-derive it inline.
- Persistence-layer `isRecord` and shrink-suffix checks import from canonical shared homes.
- Daemon `isLoadError`, `sleep`, `errorMessage`, and `isRecord` import from canonical homes with no local copies under `v2/src/daemon/` or `v2/src/ipc/`.
- Daemon hidden-shrink resume uses shared shrink suffix helpers instead of raw literals or magic slice lengths.

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
