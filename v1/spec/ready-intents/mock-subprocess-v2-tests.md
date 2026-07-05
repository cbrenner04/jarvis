---
name: mock-subprocess-v2-tests
---

# Mock the subprocess boundary in v2 tests

## Problem

Five v2 files spawn real subprocesses or real child processes/sockets:
`v2/src/daemon/daemon.sandbox-unrunnable.test.ts` (78 lines),
`v2/src/execution/external-worktree.sandbox-unrunnable.test.ts` (262 lines),
`v2/src/ipc/ipc.sandbox-unrunnable.test.ts` (157 lines),
`v2/src/persistence/log-stream.sandbox-unrunnable.test.ts` (129 lines), and
`v2/src/testing/preload.sandbox-unrunnable.test.ts` (14 lines). This is also
where the `v2-test-runner-unbounded-spawn` flake gotcha was logged.

## Scope

- Convert the bulk of these files' tests to the mocked subprocess boundary.
- Audit each test individually; keep only ones needing genuine subprocess,
  socket, or child-process behavior as explicitly-justified real-subprocess
  tests (e.g., `testing/preload.sandbox-unrunnable.test.ts` may need to stay
  real for the same reason as its shared-slice counterpart).
- Drop the `.sandbox-unrunnable` suffix from files that no longer spawn real
  subprocesses.

## Documentation updates

- None expected here — the operator-runbook cleanup for the
  `v2-test-runner-unbounded-spawn` gotcha is handled once all affected
  suites have landed.

## Prerequisites

- A mockable git/gh subprocess boundary exists for tests to use.
