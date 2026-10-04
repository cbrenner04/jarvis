---
name: daemon-start-list-use-real-handlers
---

# `daemon-start-list` tests use real run-control handlers

Rewrite `v2/src/daemon-start-list.test.ts` to wire the exported handler factory over injected fakes (state store, write-loop executor) instead of inline `RpcHandler` copies in `beforeEach`. Background runs started by real handlers complete or abort during teardown so `afterEach` cannot hang.

## Decisions

- `daemon-start-list.test.ts` uses the real handler factory with `startIpcServer` — rules out reimplementing run-control handler logic in the test file.
- Injected write-loop executor completes under test control — rules out the 50 ms `setTimeout` settlement simulation.
- `afterEach` waits for or aborts in-flight runs before closing the IPC server — rules out teardown hangs from live background work.
- Deferred to first consumer: whether sibling daemon tests need the same migration — pin when a second inline-copy file appears; only `daemon-start-list.test.ts` exists today.

## Prerequisites

- Run-control handler factory is exported from `daemon.ts` and consumed by `startDaemon`.
- Factory accepts injected state store and write-loop executor (`logReader` is tail-only; not a run-control factory dep).
