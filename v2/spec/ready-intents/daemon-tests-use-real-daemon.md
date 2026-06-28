---
name: daemon-tests-use-real-daemon
---

# Daemon tests use production handlers

Daemon run-control tests exercise the production daemon handler path with injected fakes instead of copying handler orchestration into test-local doubles.

## Prerequisites

- Daemon run-control handlers exist for start, list, pause, resume, and kill.

## Decisions

- Tests call the production daemon handler seam with fake state, executor, and log dependencies; rules out reimplementing RPC handler control flow inside tests.
- If handlers are only reachable through daemon process startup, expose a small production handler factory; rules out spawning a detached daemon as the only agent-runnable coverage path.
- Tests own background run settlement or abort in teardown; rules out timer-only settlement simulations that can hang cleanup.
- Document the production-logic-double ban in `v2/docs/test-writing.md`; rules out leaving the convention implicit.

## Acceptance focus

- `v2/src/daemon-start-list.test.ts` and sibling daemon run-control tests fail when production handler behavior regresses.
- Agent-runnable daemon tests remain sandbox-safe and deterministic.
- The test-writing docs name the daemon handler drift pattern and expected production-seam pattern.
