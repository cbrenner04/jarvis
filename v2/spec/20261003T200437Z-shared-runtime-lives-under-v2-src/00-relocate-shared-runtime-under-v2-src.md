# Relocate `shared/` under `v2/src/shared` and rewire the tree

## Problem

`shared/` is a second TypeScript project and digest pathspec root solely to serve a frozen `v1` consumer. Runtime code for `jarvis` now lives in one engine under `v2/`; keeping `shared/` at the repo root forces duplicate tsconfig, a `biome.json` `noRestrictedImports` boundary (`shared/**` must not import `v2/**`), and a separate `EXECUTABLE_TREE_PATHSPECS` entry. Active importers are `v2/`, `scripts/`, and root `test/`; `v1/` is not compiled and must not be edited.

## Decision ledger

- Target directory is `v2/src/shared/**` (preserve the `shared/` leaf name under `v2/src`); rules out flattening modules into `v2/src/` top-level domains (`execution/`, `daemon/`, …) and rules out keeping a top-level `shared/` package.
- `git mv` the tracked tree (sources, co-located tests, `fixtures/`, `prompts/` subtree) into `v2/src/shared/`; rules out copy-delete moves that drop history.
- Do not edit imports under frozen `v1/`; rules out mechanical churn in a tree that is not built or linted.
- Retire `shared/tsconfig.json` and drop the `biome.json` override block whose `includes` is `shared/**/*.ts`; fold former `shared/` into the existing `v2/src/**/*.ts` override only; rules out retaining a cross-package import ban that no longer exists.
- Update `biome.json` `files.includes` fixture ignore from `!**/shared/fixtures` to `!**/v2/src/shared/fixtures`.
- Remove `shared` and `shared/tsconfig.json` from `EXECUTABLE_TREE_PATHSPECS`; moved modules remain covered by the existing `v2/src` pathspec; rules out leaving a dead top-level `shared` pathspec after the directory is gone.
- Update `PATH_BOUNCE_CLASSIFICATION_FIXTURE` so daemon bounce uses `v2/src/shared/git.ts` instead of `shared/git.ts`.
- `package.json` `typecheck` drops the `tsc -p shared/tsconfig.json` leg; rules out a second project reference after the move.
- `scripts/run-shared-tests.ts`, `scripts/run-tests.ts`, and `test/test-slices.test.ts` discover tests under `v2/src/shared` instead of `shared/`; `test:shared` / `test:integration:shared` script names stay until `shared-test-slices-fold-into-v2-slices`.
- `scripts/ci-test-scope.ts` maps `v2/src/shared/**` like the retired `shared/**` branch (both `test:v2` and `test:shared` slices); rules out treating shared-runtime-only edits as `test:v2` alone and skipping root `test/` and `scripts/` harness tests that today ride the shared slice.
- Remove the `shared/` branch from `classifyChangedPaths`; add `v2/src/shared/` handling as above; update `scripts/ci-test-scope.test.ts` accordingly.
- Retarget root tooling that hard-codes `shared/` paths (`scripts/production-files.ts`, `scripts/guard-*.ts`, `scripts/discover-structural-invariant-tests.ts`, `scripts/guard-test-temp-dir-cleanup.ts`, coverage globs in `package.json`, and peers found by searching for `shared/` under `scripts/` and `test/`) to `v2/src/shared/`.
- Rewrite imports in `v2/`, `scripts/`, and root `test/` to the new module paths; fix relative imports inside the moved tree (including `executable-tree.test.ts` repo-root and nested-cwd URLs).

## Tasks

- [x] `git mv` all tracked content from `shared/` to `v2/src/shared/`; delete the empty `shared/` directory and `shared/tsconfig.json`.
- [x] Fix internal relative imports within `v2/src/shared/**` (including cross-subdir imports and test `import.meta.url` repo-root resolution).
- [x] Rewrite consumer imports in `v2/src/**`, `scripts/**`, and `test/**` (not `v1/**`).
- [x] Update `package.json` (`typecheck`, coverage globs), `biome.json`, `shared/executable-tree.ts` → `v2/src/shared/executable-tree.ts` pathspecs and bounce fixture, and the script/guard/discovery files listed in the decision ledger.
- [x] Extend `v2/src/shared/executable-tree.test.ts` per acceptance criteria.

## Acceptance criteria

- [x] No tracked file remains under `shared/`; `git ls-files shared/` is empty.
- [x] `biome.json` has no override whose `includes` matches `shared/**/*.ts`.
- [x] `v2/src/shared/executable-tree.test.ts` — `requiresDaemonBounceForChangedPath("v2/src/shared/git.ts")` is true and `requiresDaemonBounceForChangedPath("shared/git.ts")` is false; fails against pre-move `PATH_BOUNCE_CLASSIFICATION_FIXTURE` still classifying `shared/git.ts` as bounce-required (reachable on `main` via `shared/executable-tree.test.ts` fixture table).
- [x] `v2/src/shared/executable-tree.test.ts` — new test proves `getExecutableTreeDigest` hashes `git ls-tree` output that includes a tracked path under `v2/src/shared/` (mocked runner or committed fixture) and that the same file path would not be covered if `EXECUTABLE_TREE_PATHSPECS` still matched pre-move `shared/executable-tree.ts` on `main` without the `v2/src` tree holding that blob; fails against pre-move pathspec on `main`.
- [x] `v2/src/shared/executable-tree.test.ts` — `getExecutableTreeDigest` stability and nested-cwd tests stay green (behavior unchanged aside from pathspec membership).
- [x] `scripts/ci-test-scope.test.ts` stays green with `v2/src/shared/` substituted for the former `shared/`-only scope case.
- [x] `test/test-slices.test.ts` stays green after shared test discovery roots move to `v2/src/shared`.
- [x] `bun run typecheck` passes.
- [ ] `bun run test` passes.

## Documentation updates

- Deferred to [01-operator-documentation.md](./01-operator-documentation.md).
