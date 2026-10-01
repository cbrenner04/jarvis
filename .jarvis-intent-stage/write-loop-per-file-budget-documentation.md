---
name: write-loop-per-file-budget-documentation
---

# Test-writing docs record write-loop split and per-file headroom

## Behavior

Update `v2/docs/test-writing.md` with durable guidance: split oversized co-located suites by `describe` area into `write-loop-*.test.ts` siblings sharing `write-loop.test-support.ts`, keep each file under the `SUPPORTED_HEALTHY_FILE_BUDGET_MS` per-file gate with serial headroom (~60s target on idle hardware), preserve leaf titles via the inventory guard, and note the 2026 write-loop split alongside the existing workflow-runner precedent.

## Acceptance criteria

- [ ] `v2/docs/test-writing.md` documents per-file budget headroom and area-based splitting for large co-located suites.
- [ ] `bun run typecheck` and `bun run check` pass.
- [ ] Each co-located `write-loop*.test.ts` file from this split runs under 60s alone on an idle machine. (Manual)

## Documentation updates

- `v2/docs/test-writing.md` — per-file budget headroom guidance; split large suites by area.

## Prerequisites

- Shared write-loop test helpers and fixtures live in `write-loop.test-support.ts` and `write-loop.test.ts` already imports them.
- Merge-base write-loop leaf-title inventory guard exists and passes on the pre-split monolith anchor.
- Top-level unit describes (`buildSubspecCompletionInventory`, `persistRetainedFinalizationCheckpoint`, `applyOperatorSessionId`) already run from sibling files.
- `external implement adapter read dirs and subspec access` and `findDraftContractRepromptStateFromLog` describe groups already run from sibling files.
- `work_boundary_recorded telemetry` and the ready-finalization shell cases before `ready-gate repair autofix` already run from sibling files.
- `ready-gate repair autofix`, `runBuiltInReadyGateAutofixBiome`, and `untouched-path gate settlement` describe groups already run from sibling files.
- `ready-gate repair fence`, `admitCoLocatedTestsOfAllowedPaths`, and `refusal revert preserves pre-repair dirt` describe groups already run from sibling files.
- `coverage advisory on implement write completion` and `per-iteration git commit on progress` describe groups already run from sibling files; `write-loop.test.ts` and each split sibling hold at most 120 tests.
