---
name: run-command-iteration-control-tests
---

# Partition run-command iteration-control tests

## Problem

`v1/test/run.test.ts` still holds run-command iteration-control coverage:
loop-only mode (`git: false`), deterministic timeout bookkeeping, and blocker
adjudication. Relocate these into a dedicated iteration-control test file.

## Decisions

- Group loop-only mode, timeout bookkeeping, and blocker adjudication as one
  cohesive iteration-control test file.
- Behavior-preserving relocation only: move the assertions and production code
  unchanged.
- Keep process-backed timeout coverage in
  `v1/test/run.sandbox-unrunnable.test.ts`; it stays green and out of this
  partition.
- Leave agent stream-settlement regressions in `v1/test/run.test.ts`.

## Out of scope

- Changing run-command production behavior.
- Moving review-phase or `--resume-review` coverage.

## Documentation updates

None — test-only behavior-preserving partition.

## Prerequisites
