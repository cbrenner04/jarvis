---
name: daemon-run-control-handler-factory
---

# Daemon run-control handler factory

Extract the run-control RPC handlers (`start`/`list`/`pause`/`resume`/`kill`) from the `startDaemon` closure into an exported factory both `startDaemon` and tests consume. `startDaemon` wires production dependencies; behavior stays unchanged.

## Decisions

- Export a handler factory consumed by `startDaemon` and tests — rules out handler logic reachable only through the blocking `startDaemon` entrypoint.
- Factory accepts injected state store, log reader, and write-loop executor — rules out tests spawning a detached daemon to reach real handlers.
- `daemon.sandbox-unrunnable.test.ts` and existing daemon tests stay green — rules out semantic changes during extraction.

## Prerequisites

- Daemon run-control handlers exist in `v2/src/daemon.ts` (`start`/`list`/`pause`/`resume`/`kill`).
