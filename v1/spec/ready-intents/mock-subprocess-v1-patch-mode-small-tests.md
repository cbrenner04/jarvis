---
name: mock-subprocess-v1-patch-mode-small-tests
---

# Mock the subprocess boundary in small v1 patch-mode tests

## Problem

`v1/test/modes/patch/completion-pipeline.sandbox-unrunnable.test.ts` (87
lines), `preflight.sandbox-unrunnable.test.ts` (86 lines), and
`subspec.sandbox-unrunnable.test.ts` (569 lines) spawn real git/gh
subprocesses to test patch-mode plumbing that's mockable at the subprocess
boundary.

## Scope

- Convert the bulk of these three files' tests to the mocked subprocess
  boundary.
- Audit each test individually; keep only ones needing genuine subprocess
  behavior as explicitly-justified real-subprocess tests.
- Drop the `.sandbox-unrunnable` suffix from files that no longer spawn real
  subprocesses.

## Documentation updates

- None expected.

## Prerequisites

- A mockable git/gh subprocess boundary exists for tests to use.
