---
name: mock-subprocess-v1-patch-pr-tests
---

# Mock the subprocess boundary in v1 patch-mode PR tests

## Problem

`v1/test/modes/patch/pr.sandbox-unrunnable.test.ts` (1227 lines) spawns real
git/gh subprocesses testing patch-mode's PR-creation/update plumbing —
largely argv construction and output parsing that's mockable at the
subprocess boundary.

## Scope

- Convert the bulk of this file's tests to the mocked subprocess boundary.
- Audit each test individually; keep only ones needing genuine subprocess
  behavior as explicitly-justified real-subprocess tests.
- Drop the `.sandbox-unrunnable` suffix once the file no longer spawns real
  subprocesses for the bulk of its coverage.

## Documentation updates

- None expected.

## Prerequisites

- A mockable git/gh subprocess boundary exists for tests to use.
