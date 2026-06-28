---
name: daemon-tail-stream-handler-factory
---

# Daemon tail-stream handler factory

Extract the log-tail `StreamHandler` from the `startDaemon` closure into an exported factory both `startDaemon` and follow-on tests consume. `startDaemon` wires production `stateStore` and `logReader`; tail semantics stay unchanged.

## Decisions

- Export a tail-stream handler factory from `daemon.ts` — rules out handler logic reachable only through the blocking `startDaemon` closure.
- Factory accepts injected `stateStore` and `logReader` — rules out tests spawning a detached daemon to reach real tail semantics.
- `startDaemon` registers the factory-produced handler with production dependencies — rules out duplicate handler body left in the closure.
- This slice does not rewrite `ipc.test.ts` tail-log tests — rules out coupling extraction to test migration in one PR.
- `daemon.sandbox-unrunnable.test.ts` and existing daemon tests stay green — rules out semantic changes during extraction.

## Prerequisites

- Daemon tail-log stream semantics are implemented (`stateStore.loadRun` gates unknown runs; `follow` replays persisted events).
- Run-control handler factory extraction pattern exists in `daemon.ts` (`createRunControlHandlers`).
