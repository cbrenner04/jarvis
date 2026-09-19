# 00 — Gate lease release notification

## Problem

`liveGateInvocationLeases` (`v2/src/execution/write-loop.ts`) is module state with no way to observe a release, so the daemon cannot react when the gate slot frees.

## Decisions

- Add an exported subscribe function returning an unsubscribe; rules out polling `liveGateInvocationLeaseCount()` on a timer.
- Listeners fire once per actual release, after the lease is deleted from the live set; an idempotent second `release()` does not fire.
- Listeners are invoked asynchronously (microtask), never reentrantly from `release()`; rules out a listener acquiring a lease or resuming a run inside the releasing caller's stack.
- A throwing listener does not prevent other listeners or break `release()`.
- `acquireGateInvocationLease`, `gateInvocationAdmits`, and `MAX_CONCURRENT_AGENT_GATE_INVOCATIONS` semantics unchanged.

## Task checklist

- [ ] Subscribe function and async post-delete fan-out from the lease's `release`.
- [ ] Notification-contract tests.

## Acceptance criteria

- [x] A test proves a subscribed listener is called once after a lease release, observes `liveGateInvocationLeaseCount()` already decremented, is not called synchronously inside `release()`, and is not called again by a repeated `release()`; it fails against the pre-fix code (no subscription exists).
- [x] A test proves a throwing listener does not stop a second listener from being notified.
- [x] Existing one-slot lease ownership tests in `v2/src/execution/write-loop.test.ts` stay green.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None; internal seam with no operator-visible change until 01.
