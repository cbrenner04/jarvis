# Move ready-gate repair fence refusal revert describes

## Problem

`describe("refusal revert preserves pre-repair dirt")` is the remaining nested slice of `ready-gate repair fence` still in `write-loop.test.ts` after subspec 06; it must become its own owned sibling without re-splitting the fence body moved in 06.

## Surface

Primary: `v2/src/execution/write-loop-ready-gate-repair-fence-refusal-revert.test.ts` (new), `v2/src/execution/write-loop.test.ts`.

## Prerequisites

- Subspec 06 complete: fence body and `admitCoLocatedTestsOfAllowedPaths` run from `write-loop-ready-gate-repair-fence.test.ts`; fence helpers live in `write-loop.test-support.ts`.

## Decision ledger

- Move `describe("refusal revert preserves pre-repair dirt")` into `write-loop-ready-gate-repair-fence-refusal-revert.test.ts` still nested under `describe("ready-gate repair fence")` inside `describe("write loop")` with support hooks; import fence helpers from `write-loop.test-support.ts` only; rules out re-copying helper bodies.
- Leaf titles unchanged; rules out flattening describe paths.
- Introduced sibling holds at most 120 leaf tests; rules out landing over cap.
- Passing the ≤120 leaf guard does not satisfy the intent ~60 s idle serial headroom target; after both fence siblings land, every owned `write-loop-ready-gate-repair-fence*.test.ts` stem from subspecs 06–07 must run under ~60 s alone on idle hardware, or subspec 06–07 must land an additional time-driven split before subspec 08 may remove `write-loop.test.ts` from `LOAD_SENSITIVE_FILES`; rules out deferring wall-time relief to the count cap alone.
- New sibling meets `guard-real-lint-in-unit-tests` the same way as the monolith, or extends the allowlist in the same change; rules out deferring lint breakage to subspec 08.

## Task checklist

- Add `write-loop-ready-gate-repair-fence-refusal-revert.test.ts` with the refusal subtree moved from `write-loop.test.ts`.
- Remove the refusal block from `write-loop.test.ts` so no `ready-gate repair fence` cases remain in the monolith.

## Acceptance criteria

- [ ] `write-loop.test.ts`, `write-loop-ready-gate-repair-fence.test.ts`, and `write-loop-ready-gate-repair-fence-refusal-revert.test.ts` stay green (behavior unchanged by the move).
- [ ] `write-loop-test-inventory.test.ts` passes.
- [ ] `bun run typecheck` and `bun run check` pass.
- [ ] `describe("ready-gate repair fence")`, `describe("admitCoLocatedTestsOfAllowedPaths")`, and `describe("refusal revert preserves pre-repair dirt")` run only from `write-loop-ready-gate-repair-fence.test.ts` and `write-loop-ready-gate-repair-fence-refusal-revert.test.ts`, not from `write-loop.test.ts`.
- [ ] Each fence sibling introduced in subspecs 06–07 holds at most 120 leaf tests.
- [ ] Each owned `write-loop-ready-gate-repair-fence*.test.ts` stem runs under 60 s alone on an idle machine, or an additional time-driven split from subspec 06–07 is landed first. (Manual)

## Documentation updates

None.
