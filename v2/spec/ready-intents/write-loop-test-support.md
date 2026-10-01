---
name: write-loop-test-support
---

# Co-located write-loop tests share one support module

## Problem

`v2/src/execution/write-loop.test.ts` is a single ~13k-line file whose shared helpers, gate shell fixtures, and `runLoop` harness live inline. Splitting by `describe` would duplicate that surface or leave undeclared coupling.

## Behavior

Extract the shared write-loop unit-test helpers and fixtures from `write-loop.test.ts` into `v2/src/execution/write-loop.test-support.ts` (or the repo’s established co-located `*.test-support.ts` name beside `write-loop.ts`). Also extract the `describe("write loop")` shared `beforeEach`/`afterEach` hook setup (the `./write.ts` mock contract) into a reusable helper siblings can call. `write-loop.test.ts` imports them; no behavior change to any test title or assertion.

## Acceptance criteria

- [ ] `write-loop.test.ts` imports shared helpers from the new support module and contains no duplicate copies of the extracted symbols.
- [ ] `write-loop.test-support.ts` exports the shared `describe("write loop")` hook setup; `write-loop.test.ts` uses it instead of inline duplicate hooks.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass with the monolith still holding the full case inventory.

## Documentation updates

- None (internal test layout only until siblings land).

## Prerequisites
