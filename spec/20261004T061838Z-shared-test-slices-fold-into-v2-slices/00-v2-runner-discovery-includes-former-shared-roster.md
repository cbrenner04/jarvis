# 00 — V2 runner discovery includes the former shared roster

## Problem

`walkV2TestFiles` walks only `v2/` and excludes `v2/src/shared/`; `scripts/run-shared-tests.ts` owns `v2/src/shared`, `test/`, and `scripts/` tests. The shared slice retires only when that roster is discoverable through `run-v2-tests` without dropping files.

## Decisions

- Extend `walkV2TestFiles` to union `walkTestFiles("v2")`, `walkTestFiles("test")`, and `walkTestFiles("scripts")` with no `v2/src/shared/` exclusion — rules out relocating root `test/**` or `scripts/**` tests into `v2/`.
- Keep the `walkV2TestFiles` / `v2Tests` export names — rules out renaming slice entrypoints while `package.json` still says `test:v2`.
- `aggregateTestFiles` in `scripts/run-tests.ts` derives agent and integration rosters solely from `v2Tests` — rules out a parallel harness partition union after discovery folds.
- Former shared agent files run through `runV2TestFiles` pooled policy (not `run-shared-tests.ts` `bun test --parallel`) — rules out keeping a second agent runner for the folded paths.

## Tasks

- [x] Change `walkV2TestFiles` discovery per decisions; drop the shared exclusion filter.
- [x] Simplify `aggregateTestFiles` to `v2Tests` for both modes.
- [x] Update `scripts/run-v2-tests.test.ts` and `test/test-slices.test.ts` (owner-boundary / aggregate-roster / enumeration cases) for the unified roster; retire or rewrite `excludes v2/src/shared so shared-runtime tests stay on test:shared`, `test files are scoped to owner directories`, and `shared integration slice includes preload real-process test`.
- [x] Add inventory regression `v2 discovery roster matches former sharedTests baseline` (capture the `sharedTests` union before deleting `run-shared-tests.ts` in subspec 01).

## Acceptance criteria

- [x] `scripts/run-v2-tests.test.ts` test `v2 discovery includes former shared slice roster` asserts sorted `walkV2TestFiles()` equals the sorted union of `walkTestFiles("v2")`, `walkTestFiles("test")`, and `walkTestFiles("scripts")`; fails against pre-fix code (reachable via today's `v2/src/shared/` exclusion and missing `test/` / `scripts/` roots).
- [x] `scripts/run-v2-tests.test.ts` test `v2 discovery roster matches former sharedTests baseline` asserts every path from baseline `sharedTests("agent")` and `sharedTests("integration")` appears in `walkV2TestFiles()` and agent/integration partition matches today's `sharedTests` modes; fails against pre-fix code (reachable via today's `v2/src/shared/` exclusion and paths only on `run-shared-tests.ts`).
- [x] `test/test-slices.test.ts` test `aggregate roster matches unified v2 slice rosters` asserts `aggregateTestFiles()` equals `{ agent: v2Tests("agent"), integration: v2Tests("integration") }`; fails against pre-fix code (reachable via today's four-slice union in `aggregateTestFiles`).
- [x] `scripts/run-v2-tests.test.ts` test `excludes v2/src/shared so shared-runtime tests stay on test:shared` is removed or rewritten; pre-fix keeps it green while `walkV2TestFiles` still excludes `v2/src/shared/`.
- [x] `test/test-slices.test.ts` test `test files are scoped to owner directories` is removed or rewritten for unified discovery (no `v2/src/shared/` carve-out from `v2`); fails against pre-fix owner split.
- [x] `test/test-slices.test.ts` test `shared integration slice includes preload real-process test` is removed or rewritten to assert through `v2Tests` / `walkV2TestFiles` instead of `sharedTests`; fails against pre-fix while `sharedTests` remains the contract.
- [x] `test/test-slices.test.ts` test `test:v2 and test:integration:v2 enumerate disjoint v2 test file sets` stays green (slice partition behavior unchanged aside from roster membership).
- [x] `scripts/run-v2-tests.test.ts` pooled-runner and isolation tests outside the renamed discovery test stay green.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` and `bun run test:integration:v2` pass (runners and aggregate touched).

## Documentation updates

- None (operator-facing scope wording lands in subspec 02).
