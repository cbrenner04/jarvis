---
name: write-loop-per-file-budget-documentation
---

# Test-writing docs record write-loop split and per-file headroom

## Behavior

Update `v2/docs/test-writing.md` with durable guidance: split oversized co-located suites by `describe` area into `write-loop-*.test.ts` siblings sharing `write-loop.test-support.ts`, keep each file under the `SUPPORTED_HEALTHY_FILE_BUDGET_MS` per-file gate with serial headroom (~60s target on idle hardware), preserve merge-base leaf titles via missing-only inventory in `write-loop-test-inventory.test.ts` (surplus destination titles allowed, same as workflow-runner resume split), and note the 2026 write-loop split alongside the existing workflow-runner precedent.

## Acceptance criteria

- [ ] `v2/docs/test-writing.md` documents per-file budget headroom and area-based splitting for large co-located suites.
- [ ] `bun run typecheck` and `bun run check` pass.
- [ ] Each co-located `write-loop*.test.ts` file from this split runs under 60s alone on an idle machine. (Manual)

## Documentation updates

- `v2/docs/test-writing.md` — per-file budget headroom guidance; split large suites by area.

## Prerequisites

- `write-loop-split-implement-completion` complete: all describe moves landed; `write-loop.test.ts` and each split sibling hold at most 120 tests.
