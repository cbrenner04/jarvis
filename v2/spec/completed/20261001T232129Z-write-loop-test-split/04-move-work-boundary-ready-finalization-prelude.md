# Move work boundary and ready finalization prelude

## Problem

`work_boundary_recorded telemetry` and the `ready finalization` cases that precede the nested `ready-gate repair autofix` tree are a distinct slice from later ready-gate repair/fence work and should leave the monolith before those heavier groups move.

## Surface

Primary: `v2/src/execution/write-loop-work-boundary-ready-finalization.test.ts` (new), `v2/src/execution/write-loop.test.ts`.

## Prerequisites

- Subspec 03 complete.

## Decision ledger

- Move `describe("work_boundary_recorded telemetry")` and the `ready finalization` tests that are not under nested `ready-gate repair autofix`, `untouched-path gate settlement`, or `ready-gate repair fence`; rules out pulling autofix/fence cases forward into this file.
- Outer `describe("write loop")` plus support hooks wraps the moved integration describes; rules out leaving hook setup inline duplicated.
- Leaf titles unchanged.

## Task checklist

- Add `write-loop-work-boundary-ready-finalization.test.ts` with the prelude describes moved from `write-loop.test.ts`.
- Leave nested ready-gate repair autofix / untouched-path / fence describes in `write-loop.test.ts` for subspecs 05–07.

## Acceptance criteria

- [x] `write-loop.test.ts` and `write-loop-work-boundary-ready-finalization.test.ts` stay green (behavior unchanged by the move).
- [x] `write-loop-test-inventory.test.ts` passes.
- [x] `bun run typecheck` and `bun run check` pass.
- [x] `describe("work_boundary_recorded telemetry")` and the moved `ready finalization` prelude cases run only from `write-loop-work-boundary-ready-finalization.test.ts`, not from `write-loop.test.ts`.

## Documentation updates

None.
