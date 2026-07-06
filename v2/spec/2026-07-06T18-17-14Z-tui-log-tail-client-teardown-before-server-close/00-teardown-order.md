# Destroy client before server.close() in afterEach

## Problem

`v2/src/tui/tui-log-tail-client.test.ts`'s `afterEach` calls `server.close()` first. Only the
`socketTest` (production `connectIpcClient` over the real `SOCKET_PATH`) holds a live connection
to `server`; a thrown assertion in that test before its own `tail.close()` leaves the client socket
open, so `server.close()` in `afterEach` races a real, undrained connection.

## Decisions

- Track the real tail client from the `socketTest` in a module-level `activeTail: TuiLogTailClient | undefined`, reset to `undefined` in `beforeEach`, unconditionally before the `canUseUnixSockets()` early-return guard.
- Assign `activeTail` immediately after `connectTuiLogTail(...)` resolves in the `socketTest`, before any `expect`/assertion in that test — guarantees a mid-test throw always occurs after tracking, never before.
- `afterEach` calls `activeTail?.close()` (idempotent, safe if already closed) before `await server.close()`.
- Closing the tracked client is sufficient: `TuiLogTailClient.close()` unblocks the suspended `records()` iterator itself, ruling out a separate iterator-abort step as unnecessary.
- Other tests inject fake `connectIpcClient` transports never connected to `server`; no tracking needed for them.
- Out of scope: any change to `IpcServer.close()` itself.

## Task Checklist

- [ ] Add module-level `let activeTail: TuiLogTailClient | undefined`, reset to `undefined` at the top of `beforeEach`, before the `canUseUnixSockets()` guard.
- [ ] In the `socketTest`, assign `activeTail = tail` immediately after `connectTuiLogTail` resolves, before the first `expect(...)` call in that test.
- [ ] `afterEach` calls `activeTail?.close()` before `await server.close()`.
- [ ] Add a regression test: force a throw mid-`socketTest` after the real client connection is established (e.g. a failing assertion before `tail.close()` runs), and verify `afterEach` still completes without hanging.

## Acceptance criteria

- [ ] `tui-log-tail-client.test.ts` stays green with the reordered teardown (`bun test v2/src/tui/tui-log-tail-client.test.ts`).
- [ ] `afterEach` closes any live real client connection before calling `server.close()`.
- [ ] A regression test proves teardown completes without hanging when the real-connection test throws mid-test after connecting.

## Documentation updates

- None: test-only hygiene change, no behavior change.
