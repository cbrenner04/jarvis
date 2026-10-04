# Move ready-gate repair autofix describes

## Problem

The `ready-gate repair autofix` tree (including `runBuiltInReadyGateAutofixBiome`) and `untouched-path gate settlement` are a self-contained ready-gate slice still inflating `write-loop.test.ts` runtime.

## Surface

Primary: `v2/src/execution/write-loop-ready-gate-repair-autofix.test.ts` (new), `v2/src/execution/write-loop.test.ts`.

## Prerequisites

- Subspec 04 complete.

## Decision ledger

- Move `describe("ready-gate repair autofix")` (including nested `runBuiltInReadyGateAutofixBiome`) and `describe("untouched-path gate settlement")` under `describe("write loop")` with support hooks in `write-loop-ready-gate-repair-autofix.test.ts`; rules out leaving autofix cases in the monolith.
- Keep them nested under `describe("ready finalization")` exactly as today unless a move requires only import path changes; rules out flattening describe paths (would change leaf titles).
- Leaf titles unchanged.

## Task checklist

- Add `write-loop-ready-gate-repair-autofix.test.ts` and move the autofix and untouched-path describes from `write-loop.test.ts`.
- Remove moved blocks from `write-loop.test.ts`.

## Acceptance criteria

- [x] `write-loop.test.ts` and `write-loop-ready-gate-repair-autofix.test.ts` stay green (behavior unchanged by the move).
- [x] `write-loop-test-inventory.test.ts` passes.
- [x] `bun run typecheck` and `bun run check` pass.
- [x] `ready-gate repair autofix`, `runBuiltInReadyGateAutofixBiome`, and `untouched-path gate settlement` run only from `write-loop-ready-gate-repair-autofix.test.ts`, not from `write-loop.test.ts`.

## Documentation updates

None.
