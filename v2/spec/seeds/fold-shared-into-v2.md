---
name: fold-shared-into-v2
---

# Fold `shared/` into `v2/`

## Problem

`shared/` exists as a separate package so a second engine (`v1`) could consume the same runtime. `v1` is frozen and never compiled, and there will be no other engine, so the split now only costs: a second tsconfig, separate `test:shared` / `test:integration:shared` slices and CI scope branch (`scripts/ci-test-scope.ts:42-54`), the `shared/** must not import from v2/**` boundary rule, and a digest pathspec (`shared/executable-tree.ts`). It must go before `v2/` itself can move to the top level ([[retire-v2-nomenclature]]).

Consumers outside `v2/` today: 4 files under `scripts/`, 3 under root `test/`, 52 under frozen `v1/`.

## Decisions

- Move `shared/**` under `v2/src/` (one home for runtime code); update every import in `v2/`, `scripts/`, and root `test/`.
- Frozen `v1/` imports are left stale: `v1` is not compiled, tested, or linted, and editing it is forbidden.
- Retire `shared/tsconfig.json`, the `test:shared` / `test:integration:shared` scripts and their CI scope branch, and the `shared/**`-must-not-import-`v2/**` rule in `AGENTS.md`; fold their tests into the `v2` slices.
- Update `EXECUTABLE_TREE_PATHSPECS` so the daemon digest still covers the moved code.

## Acceptance criteria

- [ ] No tracked file remains under `shared/`; `v2/`, `scripts/`, and root `test/` import the moved modules at their new paths.
- [ ] `EXECUTABLE_TREE_PATHSPECS` covers the moved code; a test pins that a change to a moved file changes the digest.
- [ ] `package.json` has no `test:shared` / `test:integration:shared`; `scripts/ci-test-scope.ts` has no `shared/` branch and its tests pass; every former shared test runs in a `v2` slice.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `AGENTS.md` — drop `shared/` from the layout and test-scope rules.
- `v2/docs/**` references to `shared/` paths (e.g. `shared-invocation.md`, runbook), `v1-behaviors.md` entry.
