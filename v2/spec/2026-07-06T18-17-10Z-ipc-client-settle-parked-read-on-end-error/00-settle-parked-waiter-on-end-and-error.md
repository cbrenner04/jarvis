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

## Tests

- Parked unbounded `nextFrame()` rejects with `"connection closed"` on socket `'end'` (no
  `'close'` follow-up needed in the test).
- Parked unbounded `nextFrame()` rejects with `"connection closed"` on socket `'error'`.
- Emitting a socket `'error'` with no other listener does not throw/crash the test process
  (asserts the handler is attached, not just that `nextFrame()` settles).
- `tui-log-tail-client.test.ts` and `ipc.test.ts` stay green.

## Acceptance criteria

- [ ] A parked unbounded `nextFrame()` call rejects with `"connection closed"` when the socket
      emits `'end'`.
- [ ] A parked unbounded `nextFrame()` call rejects with `"connection closed"` when the socket
      emits `'error'`.
- [ ] A socket `'error'` event does not go unhandled (no uncaught exception/process crash).
- [ ] `ipc.test.ts` and `tui-log-tail-client.test.ts` stay green.
- [ ] `v2/docs/v1-behaviors.md` documents that parked `nextFrame()`/`records()` reads also
      settle on socket `'end'` and `'error'`, not just `'close'`.

## Documentation updates

- `v2/docs/v1-behaviors.md`: extend the existing `nextFrame()`/`records()` close-semantics entry
  to cover `'end'` and `'error'`, and note the socket now has an error handler.
