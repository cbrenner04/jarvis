---
name: gate-invocation-lease-module
---

# Gate invocation lease module with FIFO waiting acquire

## Problem

The one-per-daemon gate slot and release subscriptions live inside `write-loop.ts`, so waiting acquire semantics cannot be tested or reused without pulling the whole write loop; agent and daemon redrive already depend on the lease API.

## Decisions

- Move `acquireGateInvocationLease`, live-lease counting, release subscriptions, `gateInvocationAdmits`, and `MAX_CONCURRENT_AGENT_GATE_INVOCATIONS` to `v2/src/execution/gate-invocation-lease.ts`; `write-loop.ts` and `daemon-slot-redrive.ts` import them with no agent gate behavior change.
- Add `awaitGateInvocationLease({ signal, timeoutMs })`: FIFO queue, resolves with an owned lease on release; abort rejects without corrupting the queue; `timeoutMs` expiry rejects; rules out applying this API to agent gates (they keep refuse-only acquire).

## Acceptance criteria

- [ ] `v2/src/execution/gate-invocation-lease.test.ts` proves two concurrent `awaitGateInvocationLease` calls resolve in FIFO order and the second runs only after the first releases; an aborted waiter rejects and leaves the queue intact; a waiter exceeding `timeoutMs` rejects; the suite fails against a refuse-only lease without waiting acquire (reachable on main today).
- [ ] `write-loop.test.ts` gate-invocation refusal and lease-cap tests stay green (agent refuse-on-contention unchanged by the extraction).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- None (internal module move plus waiting API; operator-facing slot sharing is documented with harness gate adoption).

## Prerequisites
