# write-loop test support module

## Problem

`write-loop.test.ts` inlines shared helpers, fixtures, and the `describe("write loop")` `./write.ts` mock `beforeEach`/`afterEach` contract; every describe-area split would duplicate that surface or drift the mock contract.

## Surface

Primary: `v2/src/execution/write-loop.test-support.ts` (new), `v2/src/execution/write-loop.test.ts` (imports only in this slice).

## Decision ledger

- Shared helpers, fixtures, and hook registration used by multiple `write-loop*.test.ts` files live in `write-loop.test-support.ts`; rules out copying blocks into each split sibling.
- Export a single hook registrar (or equivalent) that applies the `describe("write loop")` `beforeEach`/`afterEach` `./write.ts` mock contract; split siblings call it inside their outer `describe("write loop")` wrapper; rules out re-stating mock.module calls per file.
- Top-level unit describes (`buildSubspecCompletionInventory`, `persistRetainedFinalizationCheckpoint`, `applyOperatorSessionId`) import support exports but do not wrap `describe("write loop")`; rules out forcing hook setup on pure unit suites.
- No new production symbols; test-support is test-only; rules out widening the production API for fixture convenience.
- Owned split siblings introduced later must meet the same `guard-real-lint-in-unit-tests` / injection pattern as the monolith, or the subspec that introduces a failing sibling extends `scripts/guard-real-lint-in-unit-tests.ts` allowlist in the same change; rules out assuming only `write-loop.test.ts` is allowlisted.

## Task checklist

- Add `write-loop.test-support.ts` with the shared helpers/fixtures currently shared across `write-loop.test.ts` describe blocks (including anything move subspecs will import).
- Export the write-loop hook setup used today by `describe("write loop")`.
- Rewire `write-loop.test.ts` to import from `./write-loop.test-support.ts` without behavior change.

## Acceptance criteria

- [ ] `write-loop.test.ts` stays green (behavior unchanged by the extraction).
- [ ] `bun run typecheck` passes.
- [ ] No `v2/src/execution/` test file duplicates the shared helper or hook bodies now centralized in `write-loop.test-support.ts`.

## Documentation updates

None — internal test refactor; durable operator guidance lands in subspec 09.
