---
name: shared-runtime-lives-under-v2-src
---

# The shared runtime lives under `v2/src`, with imports and the digest pathspec rewritten

## Problem

`shared/` is a separate package so a second engine could consume it; `v1` is frozen and never compiled, so the split only costs a second tsconfig, the `shared/**`-must-not-import-`v2/**` rule (a `biome.json` `noRestrictedImports` override), and a separate digest pathspec in `shared/executable-tree.ts`. Consumers outside `v2/` today: 5 files under `scripts/`, 3 under root `test/`, 52 under frozen `v1/`.

## Decisions

- Move `shared/**` under `v2/src/` (one home for runtime code) and rewrite every import in `v2/`, `scripts/`, and root `test/`; plan must decide the subdirectory name.
- Frozen `v1/` imports are left stale: `v1` is not compiled, tested, or linted, and editing it is forbidden.
- Retire `shared/tsconfig.json` and the `biome.json` boundary override; the rule has no meaning once the code is one tree.
- `EXECUTABLE_TREE_PATHSPECS` covers the moved code so the daemon digest still changes when it changes.

## Prerequisites

## Acceptance criteria

- [ ] No tracked file remains under `shared/`; `v2/`, `scripts/`, and root `test/` import the moved modules at their new paths; `biome.json` has no `shared/**` override.
- [ ] `executable-tree.test.ts`: a change to a moved file changes the digest; fails against the pre-move pathspec.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `AGENTS.md` — drop `shared/` from the layout and the import-boundary rule.
- `v2/docs/**` — `shared/` path references (e.g. `shared-invocation.md`, runbook); `v2/docs/v1-behaviors.md` records the move.

## Primary implementation surface

- `shared/**` → `v2/src/<subdir>/**`, `biome.json`, `tsconfig*.json`, the moved `executable-tree.ts`
