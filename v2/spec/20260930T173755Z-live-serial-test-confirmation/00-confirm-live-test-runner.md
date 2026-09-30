# 00 — Live serial confirmation runner

## Problem

Serial failure confirmation must exercise the same live roster as `bun run test` (`aggregateTestFiles()`), without bare `bun test` discovery that pulls in frozen `v1/test/**`, and without a concurrent pool.

## Decisions

- Reuse the existing aggregate seam: `scripts/run-tests.ts` main body moves into an exported `runAggregateTests(concurrency?, spawn?)` (agent phase then integration, fail-fast, unchanged), and a `--serial` argv flag passes explicit concurrency `1` to `runV2TestFiles` — rules out a new script, a re-listed roster, or bare `bun test` discovery.
- `runV2TestFiles` already spawns `bun test <file>` per file with no `--parallel`; serial means concurrency `1`, nothing else changes — rules out new spawn paths or routing through `run-shared-tests.ts`.
- `package.json` adds `"test:confirm:live": "bun run scripts/run-tests.ts --serial"` — rules out documenting a hand-rolled incantation as the contract.
- Ready-gate serial retry in `scripts/ready.ts` is out of scope.

## Tasks

- [ ] Export `runAggregateTests` from `scripts/run-tests.ts`; main parses `--serial` and passes concurrency `1`, else default concurrency.
- [ ] Add `test:confirm:live` to root `package.json`.
- [ ] Add `scripts/run-tests.test.ts` covering serial concurrency, spawn args, roster, and the script entry.

## Acceptance criteria

- [x] `scripts/run-tests.test.ts` test `serial aggregate runs one file at a time` drives `runAggregateTests(1, fakeSpawn)` and asserts max in-flight spawns is 1 and every spawn is `bun test <file>` without `--parallel`.
- [x] `scripts/run-tests.test.ts` test `serial aggregate covers the aggregate roster in agent-then-integration order` asserts the spawned files equal `[...agent, ...integration]` from `aggregateTestFiles()` and none start with `v1/`.
- [x] `scripts/run-tests.test.ts` test `test:confirm:live runs the aggregate runner serially` asserts root `package.json` maps `test:confirm:live` to `bun run scripts/run-tests.ts --serial`.
- [x] `bun run typecheck` passes.
- [x] `bun run test` passes (root tooling touched).

## Documentation updates

- None (runner contract is documented in subspec 02).
