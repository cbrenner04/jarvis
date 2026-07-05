---
name: mock-subprocess-v1-patch-review-tests
---

# Mock the subprocess boundary in v1 patch-mode review tests

## Problem

`v1/test/modes/patch/review.sandbox-unrunnable.test.ts` (1588 lines, the
largest patch-mode suite) spawns real git/gh subprocesses testing
patch-mode's review phase.

## Scope

- Convert the bulk of this file's tests to the mocked subprocess boundary.
- Audit each test individually; keep only ones needing genuine subprocess
  behavior as explicitly-justified real-subprocess tests.
- Given the file's size, consider splitting the mocked coverage into more
  than one file if a single converted file would itself be unreviewable.
- Drop the `.sandbox-unrunnable` suffix from files that no longer spawn real
  subprocesses.

## Documentation updates

- None expected.

## Prerequisites

- A mockable git/gh subprocess boundary exists for tests to use.
