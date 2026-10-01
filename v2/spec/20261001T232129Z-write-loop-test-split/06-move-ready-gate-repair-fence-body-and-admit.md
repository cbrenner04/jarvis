# Move ready-gate repair fence body and admitCoLocatedTestsOfAllowedPaths

## Problem

The `ready-gate repair fence` tree is the largest remaining nested slice in `write-loop.test.ts`; the fence body through `admitCoLocatedTestsOfAllowedPaths` is an independently movable chunk that must leave the monolith before the `refusal revert preserves pre-repair dirt` subtree.

## Surface

Primary: `v2/src/execution/write-loop-ready-gate-repair-fence.test.ts` (new), `v2/src/execution/write-loop.test-support.ts` (fence-local helpers), `v2/src/execution/write-loop.test.ts`.

## Prerequisites

- Subspec 05 complete.

## Decision ledger

- Move `describe("ready-gate repair fence")` from its opening through the end of nested `describe("admitCoLocatedTestsOfAllowedPaths")`; leave `describe("refusal revert preserves pre-repair dirt")` in `write-loop.test.ts` for subspec 07; rules out landing the full ~117-test fence tree in one subspec.
- Export fence-local helpers (`initRepairFenceWorktree`, `runRepairFenceLoop`, and siblings used by both fence stems) from `write-loop.test-support.ts` in this slice; rules out duplicating helper bodies in the refusal sibling.
- Outer `describe("write loop")` with support hooks; keep nesting under `ready finalization` and `ready-gate repair fence` as on merge-base except import paths; rules out flattening describe paths (would change leaf titles).
- Introduced sibling holds at most 120 leaf tests; rules out deferring cap enforcement.
- Passing the ≤120 leaf guard does not satisfy the intent ~60 s idle serial headroom target; after the move, measure with `bun test <file>` alone on idle hardware — if this sibling still exceeds ~60 s, land an additional time-driven split (extra owned stem or sub-describe move) in subspec 06 or 07 before subspec 08 may remove `write-loop.test.ts` from `LOAD_SENSITIVE_FILES`; rules out treating the count cap as CI wall-time relief.
- New co-located siblings meet the same `guard-real-lint-in-unit-tests` / injection pattern as the monolith, or extend `scripts/guard-real-lint-in-unit-tests.ts` allowlist in the same change; rules out deferring lint breakage to subspec 08.

## Task checklist

- Export fence-local helpers from `write-loop.test-support.ts` as needed for this slice and subspec 07.
- Add `write-loop-ready-gate-repair-fence.test.ts` with hooks and the moved fence body through `admitCoLocatedTestsOfAllowedPaths`.
- Remove the moved blocks from `write-loop.test.ts`, leaving `refusal revert preserves pre-repair dirt` under fence in the monolith until subspec 07.

## Acceptance criteria

- [ ] `write-loop.test.ts` and `write-loop-ready-gate-repair-fence.test.ts` stay green (behavior unchanged by the move).
- [ ] `write-loop-test-inventory.test.ts` passes.
- [ ] `bun run typecheck` and `bun run check` pass.
- [ ] `describe("admitCoLocatedTestsOfAllowedPaths")` and every merge-base `ready-gate repair fence` case that precedes it run only from `write-loop-ready-gate-repair-fence.test.ts`, not from `write-loop.test.ts`.
- [ ] `write-loop-ready-gate-repair-fence.test.ts` holds at most 120 leaf tests.

## Documentation updates

None.
