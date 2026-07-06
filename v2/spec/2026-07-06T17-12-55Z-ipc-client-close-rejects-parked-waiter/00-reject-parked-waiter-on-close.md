# Reject parked nextFrame() waiter on socket close

`v2/src/ipc/client.ts`'s socket `close` handler sets `closed = true` but never settles an
already-parked `nextFrame()` waiter, so an unbounded (`timeoutMs` omitted) call parked before
close never resolves or rejects. Real production hang (log-tail consumer whose daemon socket
dies mid-wait) and root cause of the intermittent `Test (v2)` CI stall via
`tui-log-tail-client.test.ts`'s retained round-trip smoke.

## Decisions

- Track the parked waiter's `reject` alongside `resolve` in both `nextFrame()` branches
  (unbounded and timed).
- On socket `close`, if a waiter is parked, clear it and reject with `new Error("connection closed")`.
- Do not raise `AGENT_MODE_TIMEOUT_MS` or add a timeout at the log-tail smoke's connect site —
  that would paper over the `client.ts` defect.
- No change to `nextFrame()`'s timed-wait semantics beyond also rejecting on close.

## Tests

- `client.ts` unit test: park an unbounded `nextFrame()`, close the socket, assert the promise
  rejects with `"connection closed"` instead of hanging.
- Same for the timed branch (parked with `timeoutMs` set, socket closes before the timer fires).
- `ipc.test.ts`, `daemon-start-list.test.ts`, `tui-log-tail-client.test.ts` stay green.

## Acceptance criteria

- [ ] An unbounded parked `nextFrame()` call rejects with `"connection closed"` when the socket
      closes, instead of hanging indefinitely.
- [ ] A timed parked `nextFrame()` call also rejects with `"connection closed"` if the socket
      closes before its timeout fires.
- [ ] `ipc.test.ts`, `daemon-start-list.test.ts`, and `tui-log-tail-client.test.ts` stay green.
- [ ] `v2/docs/v1-behaviors.md` documents that a parked `nextFrame()` read rejects with
      `"connection closed"` on socket close (add if not already documented).
- [ ] The `Test (v2)` CI-flake gotcha entry in `v1/docs/operator-runbook.md` (§ The gate,
      dated 2026-07-05) is removed or updated to reflect this fix as the actual root-cause
      closure, not just the earlier bounding mitigation.

## Documentation updates

- `v2/docs/v1-behaviors.md`: note `nextFrame()`/`records()` close semantics — parked reads now
  reject with `"connection closed"` on socket close.
- `v1/docs/operator-runbook.md`: remove/update the `Test (v2)` CI-flake gotcha now that the
  underlying stall is fixed, not just bounded.
