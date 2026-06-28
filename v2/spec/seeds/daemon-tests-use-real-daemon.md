---
name: daemon-tests-use-real-daemon
---

# v2 daemon tests exercise the real daemon, not an inline reimplementation

`v2/src/daemon-start-list.test.ts` reimplements the daemon's RPC handlers
(`startHandler`, `listHandler`, `pauseHandler`, `killHandler`, `resumeHandler`)
**inline in `beforeEach`** rather than wiring `startDaemon`/the real `daemon.ts`
handlers. The test-double drifted from production: a guard-ordering fix in the
real `daemon.ts` (check per-`(project,branch)` claim before the global
in-flight guard) had to be applied a **second time** in the test's inline copy,
because the test never exercised the real code path. The duplicate also produced
a confusing failure (a same-key second start returned `run_in_progress` instead
of `worktree_claimed`, surfacing as a teardown hook timeout).

## Problem

A test that reimplements the unit under test verifies the copy, not the product.
Behavior added/fixed in `daemon.ts` silently fails to be covered, and the two
implementations drift. This violates the v2 goal of clean interfaces with tests
that pin the real contract.

## Decisions

- `daemon-start-list.test.ts` (and any sibling daemon tests with inline handler
  copies) drive the **real** daemon — `startDaemon` or the actual handler
  factory from `daemon.ts` — over injected fakes for IPC transport, state store,
  and log reader; rules out reimplementing RPC handler logic in the test.
- If the real handlers aren't independently constructible today, extract a small
  handler-factory seam in `daemon.ts` that both the daemon process and the tests
  consume; rules out leaving handler logic only reachable through a spawned
  process.
- Background runs started by the real handlers settle or are aborted in
  teardown, so `afterEach` cannot hang; rules out the 50 ms `setTimeout`
  settlement simulation standing in for real lifecycle.
- Add a v2 test convention note: tests do not reimplement production logic as a
  local double; rules out the pattern recurring as more daemon verbs land.

## Open for refine

- Whether to keep a thin transport-level fake (sockets) while using real
  handlers, or run the full `startDaemon` over a temp socket (sandbox-unrunnable).
  Likely both: real handlers in agent-runnable tests, full detached daemon in
  `*.sandbox-unrunnable.test.ts`.

## Documentation updates

- `v2/docs/test-writing.md` — add the "don't reimplement production logic in test
  doubles" convention with the daemon handlers as the worked example.

## Prerequisites

- Daemon run-control handlers exist in `v2/src/daemon.ts`
  (`start`/`list`/`pause`/`resume`/`kill`).
