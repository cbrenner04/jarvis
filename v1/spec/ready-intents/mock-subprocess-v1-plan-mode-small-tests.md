---
name: mock-subprocess-v1-plan-mode-small-tests
---

# Mock the subprocess boundary in small v1 plan-mode tests

## Problem

`v1/test/modes/plan/git-porcelain.sandbox-unrunnable.test.ts` (34 lines) and
`v1/test/modes/plan/boundary.sandbox-unrunnable.test.ts` (238 lines) spawn
real git/gh subprocesses testing plan-mode plumbing that's mockable at the
subprocess boundary.

## Scope

- Convert the bulk of these two files' tests to the mocked subprocess
  boundary.
- Audit each test individually; keep only ones needing genuine subprocess
  behavior as explicitly-justified real-subprocess tests.
- Drop the `.sandbox-unrunnable` suffix from files that no longer spawn real
  subprocesses.

## Documentation updates

- None expected.

## Prerequisites

- A mockable git/gh subprocess boundary exists for tests to use.
