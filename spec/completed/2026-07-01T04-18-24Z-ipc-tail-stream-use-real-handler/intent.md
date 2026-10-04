---
name: ipc-tail-stream-use-real-handler
---

# `ipc.test.ts` tail-log tests exercise the real stream handler

Rewrite the three tail-log tests in `v2/src/ipc/ipc.test.ts` to wire `startIpcServer` with the exported tail-stream handler factory over injected `stateStore` and `logReader` fakes — not inline `StreamHandler` copies. Migrated assertions expect real handler behavior, including unknown-run rejection via `stateStore.loadRun`.

## Decisions

- `ipc.test.ts` tail-log tests use the real tail-stream handler factory — rules out inline `StreamHandler` copies in the test file.
- Injected fakes supply `stateStore` and `logReader`; production handler owns orchestration — rules out reimplementing `loadRun` gating or `follow` pump logic in test-local handlers.
- Unknown-run coverage exercises `stateStore.loadRun` rejection — rules out the simplified `logReader.tail()`-only mock that omits the production gate.
- Scope is `ipc.test.ts` tail-stream tests only — rules out broadening to unrelated IPC transport cases that already exercise defaults without owned-handler copies.

## Prerequisites

- Tail-stream handler factory is exported from `daemon.ts` and consumed by `startDaemon`.
- Test-writing convention documents the factory-over-fakes pattern for daemon handler tests (`createRunControlHandlers` worked example).

## Documentation updates

- `v2/docs/test-writing.md` — extend the daemon worked example or add a one-line pointer that tail-stream IPC tests follow the same factory-over-fakes pattern.
