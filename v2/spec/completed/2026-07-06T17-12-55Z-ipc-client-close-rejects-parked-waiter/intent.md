---
name: ipc-client-close-rejects-parked-waiter
---

# IPC client: reject a parked nextFrame() waiter on socket close

`v2/src/ipc/client.ts`'s socket `close` handler sets `closed = true` but never settles an
already-parked `nextFrame()` waiter. When a consumer parks an **unbounded** `nextFrame()`
(no `timeoutMs`) and the socket then closes, the returned promise never resolves or rejects —
the read hangs forever. This is a real production hang (a live log-tail consumer whose daemon
socket dies mid-wait) and the cause of the intermittent `Test (v2)` CI stall: the retained
round-trip smoke in `tui-log-tail-client.test.ts` drives production `connectTuiLogTail`, which
calls `connectIpcClient(socketPath)` with no default timeout and parks `nextFrame()` unbounded
in its `records()` loop; a connect/teardown race with the fixture server's `afterEach` close
wedges one `bun test --parallel` worker until the 300s global SIGKILL in `scripts/run-v2-tests.ts`
(agent mode), surfacing as `error: v2 "agent" test run timed out or was killed`.

Evidence: failing `Test (v2)` steps wedge at exactly 300s; passing runs finish in 3-4s — a
deadlock, not a too-tight threshold. The only unbounded real-socket read left in `test:v2`
scope after the daemon-test conversion (seeds 02–03) is this log-tail smoke.

## Prerequisites

## Decisions

- In `v2/src/ipc/client.ts`, track the parked waiter's `reject` alongside its `resolve` in
  **both** `nextFrame()` branches (the unbounded branch and the timed branch). On socket `close`,
  if a waiter is parked, clear it and reject with `new Error("connection closed")`.
- Do **not** raise `AGENT_MODE_TIMEOUT_MS` (normal runtime is 3-4s; the threshold is fine) and
  do **not** merely pass a timeout at the log-tail smoke's connect site — that would paper over
  the `client.ts` defect while leaving the production hang.
- `readTailFrame` (`v2/src/tui/tui-log-tail-client.ts`) already maps a `"connection closed"`
  error to `TuiDaemonConnectionError`, matching the documented `records()` contract — so the
  fix corrects real log-tail behavior, not just the test.

## Tests

- Add a `client.ts` unit test: park an unbounded `nextFrame()`, close the socket, assert the
  promise rejects (with the `"connection closed"` message) rather than hanging. Cover the timed
  branch too if not already covered.
- Existing `ipc.test.ts`, `daemon-start-list.test.ts`, and `tui-log-tail-client.test.ts` stay
  green.

## Out of scope

- Raising or restructuring the agent-mode test timeout.
- Any change to `nextFrame()`'s timed-wait semantics beyond also rejecting on close.
- Broader IPC protocol/framing changes.

## Documentation updates

- `v2/docs/v1-behaviors.md` if it documents `nextFrame()`/`records()` close semantics; note that
  a parked read now rejects with `"connection closed"` on socket close.
- Remove the `Test (v2)` CI-flake gotcha from `v1/docs/operator-runbook.md` (§ The gate) once
  this ships — the underlying stall is fixed, not just bounded.
