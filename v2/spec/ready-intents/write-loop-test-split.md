---
name: write-loop-test-split
---

# write-loop.test.ts splits by describe area to fit the per-file budget

## Problem

`v2/src/execution/write-loop.test.ts` (~13.8k lines) runs ~170 s serial on an idle machine against the 180 s `SUPPORTED_HEALTHY_FILE_BUDGET_MS` per-file timeout (`scripts/run-v2-tests.ts`). Any concurrent load times it out, so every lane touching `v2/**` red-gates on it regardless of diff (2026-10-01: runs a360bdd6, c7cd745e x2; #4328 hand-finish). Every new write-loop test makes it worse.

## Decisions

- One plan, chained subspecs on one branch, in this order: support module → inventory guard → describe-area moves (one subspec per bullet below) → docs.
- Support module: shared helpers, fixtures, and the `describe("write loop")` `beforeEach`/`afterEach` setup (the `./write.ts` mock contract) move to `v2/src/execution/write-loop.test-support.ts`; no duplicated copies.
- Inventory guard: `v2/src/execution/write-loop-test-inventory.test.ts`, same pattern as `workflow-runner-resume-inventory.test.ts`: anchors merge-base `write-loop.test.ts` leaf titles, asserts missing-only parity across owned `write-loop*.test.ts` destinations (surplus allowed; unrelated stems like `write-loop-input`, `write-loop-intent-landing` excluded).
- Moves into co-located `write-loop-<area>.test.ts` siblings; integration siblings re-wrap under `describe("write loop")` via the support hooks:
  - top-level units: `buildSubspecCompletionInventory`, `persistRetainedFinalizationCheckpoint`, `applyOperatorSessionId` (no hook wrapper).
  - `external implement adapter read dirs and subspec access`, `findDraftContractRepromptStateFromLog`.
  - `work_boundary_recorded telemetry` and the `ready finalization` cases preceding `ready-gate repair autofix`.
  - `ready-gate repair autofix` (incl. `runBuiltInReadyGateAutofixBiome`), `untouched-path gate settlement`.
  - `ready-gate repair fence` (incl. `admitCoLocatedTestsOfAllowedPaths`, `refusal revert preserves pre-repair dirt`).
  - `coverage advisory on implement write completion`, `per-iteration git commit on progress`, plus direct `write loop` cases by area as needed to meet the cap; the core `write loop` smoke tests stay in `write-loop.test.ts`.
- Cap: `write-loop.test.ts` and every sibling added by the split hold at most 120 tests.
- Leaf test titles unchanged (mutation killing-set resolution already includes `<stem>-*.test.ts` siblings).
- The 180 s per-file budget is unchanged; no per-file exemptions.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test-support.ts` exports the shared helpers and `write loop` hook setup; no test file under `v2/src/execution/` duplicates them.
- [ ] `v2/src/execution/write-loop-test-inventory.test.ts` passes on the split tree and fails when any merge-base `write-loop.test.ts` leaf title is absent from the owned destinations.
- [ ] Every describe group named in Decisions runs from a `write-loop-<area>.test.ts` sibling, not `write-loop.test.ts`.
- [ ] `write-loop.test.ts` and each split sibling hold at most 120 tests.
- [ ] `bun run typecheck`, `bun run check`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` — per-file budget headroom (~60 s serial target); split large co-located suites by `describe` area with a shared `*.test-support.ts` and a missing-only inventory guard; cite the write-loop and workflow-runner-resume splits.

## Operator verification

- Each `write-loop*.test.ts` file from the split runs under 60 s alone on an idle machine.

## Prerequisites
