# 01 — Retire shared slice entrypoints and CI scope

## Problem

`package.json` still exposes `test:shared` / `test:integration:shared`, `scripts/ci-test-scope.ts` emits those scripts for `v2/src/shared/**` and `test/**`, and `scripts/run-shared-tests.ts` duplicates discovery subspec 00 folded into `run-v2-tests`.

## Decisions

- Remove `test:shared` and `test:integration:shared` from root `package.json` and delete `scripts/run-shared-tests.ts` — rules out leaving dormant scripts that imply a second slice.
- `classifyChangedPaths` sets only `needsV2` for `v2/src/shared/**` and `test/**`; drop `needsShared` — rules out emitting retired script names from CI or ready scope.
- `scripts/` production paths remain `ROOT_TOOLING_PATTERNS` → `full` (unchanged); only `scripts/**/*.test.ts` moves with discovery in subspec 00, not CI classification.

## Tasks

- [x] Delete `scripts/run-shared-tests.ts`.
- [x] Remove shared test scripts from `package.json`.
- [x] Update `scripts/ci-test-scope.ts` and `scripts/ci-test-scope.test.ts`.
- [x] Update `test/test-slices.test.ts` cases that assert `test:shared` script wiring or four-slice aggregate unions.

## Acceptance criteria

- [x] Root `package.json` has no `test:shared` or `test:integration:shared` keys (`test/test-slices.test.ts` or `scripts/ci-test-scope.test.ts` pins this; fails against pre-fix `package.json`).
- [x] `scripts/ci-test-scope.test.ts` test `shared-only change runs v2 slices only` expects `resolveCiTestScope(["v2/src/shared/git.ts"], true)` to equal `["test:v2", "test:integration:v2"]` only; fails against pre-fix code (reachable via today's `test:shared` / `test:integration:shared` emission in `scripts/ci-test-scope.ts`).
- [x] `scripts/ci-test-scope.test.ts` test `test/ (harness) change runs v2 test slices` expects `resolveCiTestScope(["test/setup-fake-agents.ts"], true)` to equal `["test:v2", "test:integration:v2"]`; fails against pre-fix code (reachable via today's shared-only classification for `test/`).
- [x] `test/test-slices.test.ts` test `aggregate roster is exactly the union of four scoped rosters` is removed or replaced so the suite no longer references `sharedTests` or `run-shared-tests.ts`.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` and `bun run test:integration:v2` pass.
- [x] `bun run test` passes (package.json and root tooling touched).

## Documentation updates

- None (subspec 02).
