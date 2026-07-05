---
name: mock-subprocess-v1-agent-spawn-tests
---

# Mock the subprocess boundary in v1 agent-spawn tests

## Problem

`v1/test/agents/spawn.sandbox-unrunnable.test.ts` (578 lines) spawns real
agent-CLI subprocesses to test argv construction, output parsing, and
exit-code handling in `v1/src/agents/spawn.ts` — behavior that's mockable at
the subprocess boundary.

## Scope

- Convert the bulk of this file's tests to the mocked subprocess boundary:
  assert on constructed argv/env and reaction to canned
  stdout/stderr/exit-code without launching a real agent CLI.
- Audit each test individually; keep only the ones that must exercise a real
  spawned process (e.g., genuine stream-buffering or process-group/kill
  behavior) as explicitly-justified real-subprocess tests, with a one-line
  comment stating why.
- Drop the `.sandbox-unrunnable` suffix from the file once it no longer
  spawns real subprocesses for the bulk of its coverage, or split any
  remaining justified real-subprocess tests into a separate file that keeps
  the suffix.

## Documentation updates

- None expected — internal test-infrastructure change only.

## Prerequisites

- A mockable git/gh subprocess boundary exists for tests to use.
