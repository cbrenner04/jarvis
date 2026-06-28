---
name: daemon-start-list-use-real-handlers
---

# `daemon-start-list` tests use real run-control handlers

Rewrite `v2/src/daemon-start-list.test.ts` to wire the exported handler factory over injected fakes (state store, log reader, write-loop executor) instead of inline `RpcHandler` copies in `beforeEach`. Background runs started by real handlers complete or abort during teardown so `afterEach` cannot hang.

## Decisions

- `daemon-start-list.test.ts` uses the real handler factory with `startIpcServer` — rules out reimplementing run-control handler logic in the test file.
- Injected write-loop executor completes under test control — rules out the 50 ms `setTimeout` settlement simulation.
- `afterEach` waits for or aborts in-flight runs before closing the IPC server — rules out teardown hangs from live background work.
- Deferred to first consumer: whether sibling daemon tests need the same migration — pin when a second inline-copy file appears; only `daemon-start-list.test.ts` exists today.

## Prerequisites

- Run-control handler factory is exported from `daemon.ts` and consumed by `startDaemon`.
- Factory accepts injected state store, log reader, and write-loop executor.

## Blocker

- No exported run-control handler factory in `v2/src/daemon.ts` — `start`/`list`/`pause`/`resume`/`kill` handlers are defined inline inside `startDaemon`; nothing is exported for tests to consume.
- No injectable write-loop executor seam — `startDaemon` calls `executeWriteLoop` directly in background IIFEs; only optional `stateStore` and `logReader` params exist on `startDaemon`, not a factory with executor injection.

Land `daemon-run-control-handler-factory` (ready intent at `v2/spec/ready-intents/daemon-run-control-handler-factory.md`) first, then re-run plan for this intent.
