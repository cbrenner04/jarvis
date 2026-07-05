---
name: mock-subprocess-v1-idle-hang-tests
---

# Mock the subprocess boundary in v1 idle-hang-fixture tests

## Problem

`v1/test/idle-hang-fixtures.sandbox-unrunnable.test.ts` (102 lines) covers
idle/stall detection for spawned agent processes. Some of its coverage may
inherently require a real subprocess that actually stalls or times out; the
rest is mockable output/timer plumbing.

## Scope

- Audit each test: convert argv-construction and output-parsing coverage to
  the mocked subprocess boundary.
- Keep only genuine stall/timeout/kill-path tests as explicitly-justified
  real-subprocess tests (this is the canonical case the seed calls out for
  keeping real subprocesses), with a one-line comment stating why.
- Drop the `.sandbox-unrunnable` suffix from any split-off mocked file.

## Documentation updates

- None expected.

## Prerequisites

- A mockable git/gh subprocess boundary exists for tests to use.
