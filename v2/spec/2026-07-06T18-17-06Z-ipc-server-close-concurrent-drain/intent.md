---
name: ipc-server-close-concurrent-drain
---

# IpcServer.close() runs forced socket-drain concurrently, not nested in server.close callback

## Prerequisites

## Problem

`IpcServer.close()` (`v2/src/ipc/server.ts`) nests the forced `waitForSocketDrain` inside
`net.Server.close(cb)`'s callback. Node/Bun fire that callback only after all existing
connections have already ended; `server.close()` does not destroy established sockets. With a
client connection still open, the callback never fires, the drain never runs, and `close()`
hangs forever — the true root cause of the intermittent `Test (v2)` CI stall.

## Decisions

- Run the forced `waitForSocketDrain` concurrently with `server.close`, not inside its callback:
  destroying lingering sockets is what causes their connections to end and the callback to fire.
- `close()` must resolve within `drainTimeoutMs` when a connection is still open, instead of hanging.

## Tests

- `server.ts` unit/integration test: open a real client connection, call `IpcServer.close()`,
  assert it resolves within `drainTimeoutMs` (lingering socket force-destroyed) rather than hanging.
- Existing `ipc.test.ts`, `daemon-start-list.test.ts` stay green.

## Out of scope

- Raising `AGENT_MODE_TIMEOUT_MS` or any test-timeout tuning.
- IPC protocol/framing changes.

## Documentation updates

- `v2/docs/v1-behaviors.md` / `v2/docs/daemon-host.md` if either documents `IpcServer.close()`
  drain semantics — note close now force-drains lingering sockets concurrently and resolves
  within `drainTimeoutMs`.
