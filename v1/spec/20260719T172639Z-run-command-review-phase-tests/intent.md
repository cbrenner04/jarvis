---
name: run-command-review-phase-tests
---

# Partition run-command review-phase tests

## Problem

`v1/test/run.test.ts` still holds run-command completion-review coverage and
`--resume-review` coverage. Relocate these into a dedicated review test file.

## Decisions

- Group completion review and `--resume-review` coverage as one cohesive review
  test file.
- Behavior-preserving relocation only: move the assertions and production code
  unchanged.
- Move only review-phase and `--resume-review` cases; leave agent
  stream-settlement regressions in `v1/test/run.test.ts`.

## Out of scope

- Changing run-command production behavior.
- Moving loop-only, timeout, or blocker coverage.

## Documentation updates

None — test-only behavior-preserving partition.

## Prerequisites
