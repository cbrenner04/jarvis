# Reject parked nextFrame() waiter on socket close

`v2/src/ipc/client.ts`'s socket `close` handler sets `closed = true` but never settles an
already-parked `nextFrame()` waiter, so an unbounded (`timeoutMs` omitted) call parked before
close never resolves or rejects. Real production hang (log-tail consumer whose daemon socket
dies mid-wait). The fix removes this hang mechanism (no settlement on close), which is also the
only unbounded real-socket read left in `test:v2` scope and thus a plausible contributor to the
intermittent `Test (v2)` CI stall observed via `tui-log-tail-client.test.ts`'s retained
round-trip smoke — the deterministic unit test below covers the mechanism directly; the
intermittent CI race itself is not independently reproduced or re-tested here.

`readTailFrame` (`v2/src/tui/tui-log-tail-client.ts`) already maps a `"connection closed"` error
to `TuiDaemonConnectionError`, so this fix's scope stops at `client.ts` — no follow-on change is
needed in `tui-log-tail-client.ts`.

## Decisions

- The existing single parked-waiter slot is extended to carry `reject` alongside `resolve`
  (e.g., `{resolve, reject} | null`) — the unbounded and timed branches share this one slot
  today; this is not a second, branch-local variable.
- On socket `close`, if a waiter is parked, clear it and reject with `new Error("connection closed")`.
- If the parked waiter is the timed variant, clear its pending timer before rejecting on close —
  otherwise the fix leaves a stale timer, the same class of dangling-async-work bug it exists to close.
- Do not raise `AGENT_MODE_TIMEOUT_MS` or add a timeout at the log-tail smoke's connect site —
  that would paper over the `client.ts` defect.
- No change to `nextFrame()`'s timed-wait semantics beyond also rejecting on close.

## Tests

- `client.ts` unit test: park an unbounded `nextFrame()`, close the socket, assert the promise
  rejects with `"connection closed"` instead of hanging.
- Same for the timed branch (parked with `timeoutMs` set, socket closes before the timer fires);
  assert the timer is cleared (no stray rejection/resolution after close).
- Consumer-initiated close and remote socket close both fire the same `close` handler, so one
  rejection test per branch covers both origins by construction — no separate per-origin test needed.
- `ipc.test.ts`, `daemon-start-list.test.ts`, `tui-log-tail-client.test.ts` stay green.

## Acceptance criteria

- [x] An unbounded parked `nextFrame()` call rejects with `"connection closed"` when the socket
      closes, instead of hanging indefinitely.
- [x] A timed parked `nextFrame()` call also rejects with `"connection closed"` if the socket
      closes before its timeout fires, and its pending timer is cleared.
- [x] `ipc.test.ts`, `daemon-start-list.test.ts`, and `tui-log-tail-client.test.ts` stay green.
- [x] `v2/docs/v1-behaviors.md` documents that a parked `nextFrame()` read rejects with
      `"connection closed"` on socket close (add if not already documented).
- [x] The dated `Test (v2)` CI-flake gotcha entry (2026-07-05) no longer appears in
      `v1/docs/operator-runbook.md` § The gate.

## Documentation updates

- `v2/docs/v1-behaviors.md`: note `nextFrame()`/`records()` close semantics — parked reads now
  reject with `"connection closed"` on socket close.
- `v1/docs/operator-runbook.md`: remove/update the `Test (v2)` CI-flake gotcha now that the
  underlying stall is fixed, not just bounded.
