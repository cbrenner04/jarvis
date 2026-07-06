---
name: ipc-client-settle-parked-read-on-end-error
---

# IPC client settles a parked nextFrame() read on socket 'end' and 'error', and handles socket errors

## Prerequisites

## Problem

`v2/src/ipc/client.ts` only settles a parked `nextFrame()` waiter on socket `'close'` (PR #1143).
A daemon connection reset (RST → `'error'`, no clean `'close'`) leaves the read parked forever,
and there is no `socket.on("error", …)` handler, so an unhandled socket error can crash the process.

## Decisions

- Settle a parked `nextFrame()` waiter on socket `'end'` and on `'error'`, in addition to `'close'`.
- Add a `socket.on("error", …)` handler so an unhandled socket error does not crash the process.
- Must not break long-quiet tailing: settle only on real disconnect, never on mere silence.

## Tests

- Parked unbounded `nextFrame()` rejects on socket `'end'` and on `'error'` (in addition to the
  existing `'close'` case).
- A socket `'error'` does not go unhandled.
- Existing `tui-log-tail-client.test.ts` stays green.

## Out of scope

- IPC protocol/framing changes.
- Server-side changes.

## Documentation updates

- None expected; internal robustness fix to already-documented close-reject behavior.
