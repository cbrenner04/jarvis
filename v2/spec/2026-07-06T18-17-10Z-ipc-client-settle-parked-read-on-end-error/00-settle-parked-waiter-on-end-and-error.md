# Settle parked nextFrame() waiter on socket end/error; handle socket errors

`v2/src/ipc/client.ts` only settles a parked `nextFrame()` waiter on socket `'close'` (PR #1143).
A connection reset (RST → `'error'`, no clean `'close'`) or a half-close (`'end'` without
`'close'`) leaves the read parked forever. There is no `socket.on("error", …)` handler, so an
unhandled socket error can crash the process.

## Decisions

- Extract the existing close-handler settlement logic (clear waiter, clear its timer, reject
  with `"connection closed"`, set `closed = true`) into one shared function; call it from
  `'close'`, `'end'`, and `'error'` handlers so first-to-fire wins and later events are no-ops
  (existing `if (waiter)` guard already makes this idempotent).
- Add `socket.on("error", …)` so an unhandled socket error does not crash the process; the
  handler settles the parked waiter via the shared function (same `"connection closed"`
  rejection — the intent does not ask for surfacing the underlying `Error`, and none of
  `client.ts`'s current callers branch on error message content beyond `"connection closed"`).
- `'end'` fires before `'close'` on a clean disconnect (Node socket lifecycle) and would
  otherwise double-settle harmlessly given the guard above; no special-casing needed to avoid
  it.
- No handler settles or rejects merely from the absence of data — only `'end'`, `'close'`, and
  `'error'` trigger settlement, so long-quiet tailing on an open socket is unaffected.
- Test-only mechanism for genuine `'end'`/`'error'`: a bare `net.createServer` (bypassing
  `startIpcClient`/`startIpcServer` entirely, mirroring `connectRaw()`'s existing bypass in the
  other direction) that the client connects to directly, so the test controls the accepted
  server-side socket and can call `socket.end()` for a real `'end'` or
  `socket.resetAndDestroy()` for a real `'error'` (RST). The existing `'close'` test's
  `client.close()` → `socket.destroy()` path cannot produce either.

## Tests

- Parked unbounded `nextFrame()` rejects with `"connection closed"` on genuine socket `'end'`,
  driven via the raw test server calling `socket.end()` on the accepted connection.
- Parked unbounded `nextFrame()` rejects with `"connection closed"` on genuine socket `'error'`,
  driven via the raw test server calling `socket.resetAndDestroy()` on the accepted connection.
- Emitting a socket `'error'` with no other listener does not throw/crash the test process
  (asserts the handler is attached, not just that `nextFrame()` settles).
- An unbounded `nextFrame()` stays pending across a period of socket inactivity (no `'end'`,
  `'close'`, or `'error'`) and only settles once a real disconnect event fires afterward.
- `tui-log-tail-client.test.ts` and `ipc.test.ts` stay green.

## Acceptance criteria

- [ ] A parked unbounded `nextFrame()` call rejects with `"connection closed"` when the socket
      emits a genuine `'end'` (half-close, no prior `'close'`).
- [ ] A parked unbounded `nextFrame()` call rejects with `"connection closed"` when the socket
      emits a genuine `'error'` (connection reset).
- [ ] A socket `'error'` event does not go unhandled (no uncaught exception/process crash).
- [ ] An unbounded `nextFrame()` remains pending through a period of socket inactivity and only
      settles once a real disconnect (`'end'`/`'close'`/`'error'`) occurs.
- [ ] `ipc.test.ts` and `tui-log-tail-client.test.ts` stay green.
- [ ] `v2/docs/v1-behaviors.md` documents that parked `nextFrame()`/`records()` reads also
      settle on socket `'end'` and `'error'`, not just `'close'`.

## Documentation updates

- `v2/docs/v1-behaviors.md`: extend the existing `nextFrame()`/`records()` close-semantics entry
  to cover `'end'` and `'error'`, and note the socket now has an error handler.
