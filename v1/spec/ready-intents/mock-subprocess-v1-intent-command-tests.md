---
name: mock-subprocess-v1-intent-command-tests
---

# Mock the subprocess boundary in v1 intent-command tests

## Problem

`v1/test/intent-command.sandbox-unrunnable.test.ts` (2057 lines, the largest
suite in the whole repo) spawns real git/gh subprocesses testing the
`jarvis1 intent` seed/draft/split pipeline.

## Scope

- Convert the bulk of this file's tests to the mocked subprocess boundary.
- Audit each test individually; keep only ones needing genuine subprocess
  behavior as explicitly-justified real-subprocess tests.
- Given the file's size, split the mocked coverage into more than one file
  if a single converted file would itself be unreviewable.
- Drop the `.sandbox-unrunnable` suffix from files that no longer spawn real
  subprocesses.

## Documentation updates

- None expected.

## Prerequisites

- A mockable git/gh subprocess boundary exists for tests to use.
