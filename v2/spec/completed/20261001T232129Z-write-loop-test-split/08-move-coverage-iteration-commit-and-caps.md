# Move coverage and iteration commit; enforce per-file caps

## Problem

`coverage advisory on implement write completion` and `per-iteration git commit on progress` remain in the monolith alongside the core `write loop` smoke tests; the intent caps every owned split file at 120 tests and targets ~60 s serial headroom under the unchanged 180 s budget.

## Surface

Primary: `v2/src/execution/write-loop-coverage-and-iteration-commit.test.ts` (new), `v2/src/execution/write-loop.test.ts`, `v2/src/execution/write-loop-test-inventory.test.ts` (cap guard), `scripts/test-slice.ts`, `v2/docs/v1-behaviors.md`.

## Prerequisites

- Subspec 07 complete: full fence tree lives in fence siblings; each owned `write-loop-ready-gate-repair-fence*.test.ts` stem meets ~60 s idle serial alone, or subspecs 06–07 already landed the required time-driven split.

## Decision ledger

- Move `describe("coverage advisory on implement write completion")` and `describe("per-iteration git commit on progress")` into `write-loop-coverage-and-iteration-commit.test.ts` under `describe("write loop")` with support hooks; rules out keeping them in the monolith.
- `write-loop.test.ts` retains only the direct `write loop` smoke tests (five cases on merge-base) plus any minimal glue imports; rules out leaving heavy integration groups in the monolith for convenience.
- Extend `write-loop-test-inventory.test.ts` (or a co-located assertion in that file) to fail when any owned destination exceeds 120 leaf tests counted by the same scanner; rules out manual-only cap enforcement.
- `SUPPORTED_HEALTHY_FILE_BUDGET_MS` stays 180_000; no per-file timeout exemptions; rules out raising the budget instead of splitting.
- Remove `v2/src/execution/write-loop.test.ts` from `LOAD_SENSITIVE_FILES` in `scripts/test-slice.ts` once owned split files meet the headroom target, with a dated comment citing idle serial measurements; rules out leaving load-sensitive classification on a file that no longer tips the budget.

## Task checklist

- Add `write-loop-coverage-and-iteration-commit.test.ts` and move the two describes from `write-loop.test.ts`.
- Trim `write-loop.test.ts` to core smoke tests.
- Add the ≤120 leaf-test guard to the inventory test for every owned destination.
- Drop the `write-loop.test.ts` `LOAD_SENSITIVE_FILES` entry when measurements support it (operator may confirm timing in human-verify criteria).

## Acceptance criteria

- [x] `write-loop.test.ts`, `write-loop-coverage-and-iteration-commit.test.ts`, and the other split siblings stay green (behavior unchanged by the move).
- [x] `write-loop-test-inventory.test.ts` passes, including the at-most-120 leaf-test guard for each owned destination.
- [x] `describe("coverage advisory on implement write completion")` and `describe("per-iteration git commit on progress")` run only from `write-loop-coverage-and-iteration-commit.test.ts`.
- [x] `write-loop.test.ts` holds at most 120 leaf tests and contains no describe groups named in the intent decision list except the core `write loop` smoke cases.
- [x] `bun run typecheck`, `bun run check`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [x] Each owned `write-loop*.test.ts` split destination from this spec runs under 60 s alone on an idle machine. (Manual)

## Documentation updates

- `v2/docs/v1-behaviors.md` — record `write-loop.test.ts` leaving `LOAD_SENSITIVE_FILES` once split siblings meet idle serial headroom (observable harness execution-policy change).

## Verification

2026-10-02: all 315 merge-base leaf cases preserved across 13 owned destinations (maximum 62/file); standalone serial runs 0.25–32.69 s/file. Full `bun run test`, unscoped typecheck, check, and markdown lint passed. Shared ready-finalize fixtures were extracted to prevent fixture imports from executing another 104-test suite.
