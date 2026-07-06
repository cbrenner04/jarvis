# Destroy client before server.close() in afterEach

## Problem

`v2/src/tui/tui-log-tail-client.test.ts`'s `afterEach` calls `server.close()` first. Only the
`socketTest` (production `connectIpcClient` over the real `SOCKET_PATH`) holds a live connection
to `server`; a thrown assertion in that test before its own `tail.close()` leaves the client socket
open, so `server.close()` in `afterEach` races a real, undrained connection.

## Decisions

- Track the real tail client from the `socketTest` in a module-level variable, reset in `beforeEach`.
- `afterEach` closes that tracked client (idempotent, safe if already closed) before calling `server.close()`.
- Other tests inject fake `connectIpcClient` transports never connected to `server`; no tracking needed for them.
- Out of scope: any change to `IpcServer.close()` itself.

## Task Checklist

- [ ] Add a module-level `activeTail` (or equivalent) reset to `undefined` in `beforeEach`.
- [ ] Assign it when the `socketTest` production-transport test opens a real tail client.
- [ ] `afterEach` calls `activeTail?.close()` before `await server.close()`.

## Acceptance criteria

- [ ] `tui-log-tail-client.test.ts` stays green with the reordered teardown (`bun test v2/src/tui/tui-log-tail-client.test.ts`).
- [ ] `afterEach` closes any live real client connection before calling `server.close()`.

## Documentation updates

- None: test-only hygiene change, no behavior change.
