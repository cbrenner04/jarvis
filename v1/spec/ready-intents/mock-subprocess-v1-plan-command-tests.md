---
name: mock-subprocess-v1-plan-command-tests
---

# Mock the subprocess boundary in v1 plan-command tests

## Problem

`v1/test/plan-command.sandbox-unrunnable.test.ts` (1356 lines) spawns real
git/gh subprocesses testing the `jarvis1 plan` command's top-level flow.

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
