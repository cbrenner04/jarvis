# 00 — Gate invocation lease module

## Problem

Gate lease state, refuse-only acquire, and release subscriptions live in `write-loop.ts`; harness finalization needs a FIFO waiting acquire on the same live set without changing agent refuse-on-contention.

## Decisions

- Move `acquireGateInvocationLease`, live-lease counting, release subscriptions, `gateInvocationAdmits`, and `MAX_CONCURRENT_AGENT_GATE_INVOCATIONS` to `v2/src/execution/gate-invocation-lease.ts`; `write-loop.ts` and `daemon-slot-redrive.ts` import them with no agent gate behavior change; rules out duplicating lease state in finalization.
- Add `awaitGateInvocationLease({ signal, timeoutMs })`: FIFO queue, resolves with an owned lease when capacity frees; abort on `signal` rejects the waiter without corrupting the queue; `timeoutMs` expiry rejects; rules out applying this API to agent gates (they keep refuse-only `acquireGateInvocationLease`).
- Agent iteration gate tracking continues to call refuse-only acquire only; rules out queueing agent shell gates behind a held finalization lease inside the tracker (finalization waits in 01 instead).

## Task checklist

- [x] New `gate-invocation-lease.ts` with moved lease set, subscribe/notify, refuse-only acquire, and `awaitGateInvocationLease`.
- [x] Rewire `write-loop.ts` and `daemon-slot-redrive.ts` imports; re-export from `write-loop.ts` only if existing importers would otherwise churn unnecessarily.
- [x] `gate-invocation-lease.test.ts` for FIFO wait, abort, timeout, and refuse-only acquire.

## Acceptance criteria

- [x] `v2/src/execution/gate-invocation-lease.test.ts` proves two concurrent `awaitGateInvocationLease` calls resolve in FIFO order and the second runs only after the first releases; an aborted waiter rejects and leaves the queue intact; a waiter exceeding `timeoutMs` rejects; the suite fails against a refuse-only lease without waiting acquire (reachable on main today).
- [x] `write-loop.test.ts` gate-invocation refusal and lease-cap tests stay green (agent refuse-on-contention unchanged by the extraction).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

None; operator-visible serialization lands in 01.
