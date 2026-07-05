---
name: mock-subprocess-v1-patch-shrink-tests
---

# Mock the subprocess boundary in v1 patch-mode shrink tests

## Problem

`v1/test/modes/patch/shrink.sandbox-unrunnable.test.ts` (1079 lines) spawns
real git/gh subprocesses testing patch-mode's shrink phase, including the
`ci-shrink-test-hang` flake logged against this suite this session.

## Scope

- Convert the bulk of this file's tests to the mocked subprocess boundary.
- Audit each test individually; keep only ones needing genuine subprocess
  behavior (e.g., a real timeout/stall path) as explicitly-justified
  real-subprocess tests.
- Drop the `.sandbox-unrunnable` suffix once the file no longer spawns real
  subprocesses for the bulk of its coverage.

## Documentation updates

- None expected here — the operator-runbook cleanup for the `ci-shrink-test-hang`
  gotcha is handled once all affected suites have landed.

## Prerequisites

- A mockable git/gh subprocess boundary exists for tests to use.
