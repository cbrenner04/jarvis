---
name: finalization-gates-await-gate-slot
---

# Harness finalization full-suite gates wait for the shared gate slot

## Problem

`bun run ready`, required integration, and ready-gate repair re-gates spawn full suites without holding the daemon gate slot, so concurrent publishing lanes run N suites and false `ready_gate_failed` timeouts follow.

## Decisions

- Default ready gate, required integration, and each repair re-gate in `publishCompletionArtifacts` await `awaitGateInvocationLease` before spawn, release in `finally`, and re-acquire on each repair re-gate after the repair agent releases the prior hold; base-ref probes and scoped verifier runs stay outside the slot.
- Wait is bounded by `readyGateSubprocessTimeoutMs()` and aborted by the run signal; wait time does not consume the gate subprocess deadline (armed at spawn). Expiry throws `ReadyGateError` with `timedOut: true` and output naming the slot wait; rules out a new failure kind.
- When acquire did not resolve immediately, log `ready_gate_slot_wait` with `gate` and `waitedMs`; while queued, `jarvis run list` `message` shows `waiting for gate slot`.

## Acceptance criteria

- [ ] `v2/src/execution/ready-finalize.test.ts` proves two concurrent `createReadyFinalizer` runs over a stubbed `asyncSubprocessRunner` never overlap gate spawns (max in-flight 1), required integration holds the lease, and a held agent lease delays the finalization gate until released; fails against pre-fix code with unleased harness spawns (reachable on main today).
- [ ] `v2/src/execution/ready-finalize.test.ts` proves slot-wait expiry surfaces `ReadyGateError` with `timedOut: true` naming the slot wait; fails against pre-fix code with no slot wait (reachable on main today).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Concurrency — slot covers harness finalization gates; finalization waits while agents refuse; document `ready_gate_slot_wait` and `waiting for gate slot`.
- `v2/docs/write-behavior.md` — finalization gate serialization and repair re-acquire on the shared slot.
- `v2/docs/v1-behaviors.md` — record harness finalization sharing the daemon gate slot.

## Prerequisites

- Gate invocation lease accounting lives in `v2/src/execution/gate-invocation-lease.ts` with refuse acquire, live-lease counting, and release subscriptions consumed by the write loop and daemon slot redrive.
- `awaitGateInvocationLease` queues waiters in FIFO order and returns an owned releasable lease when the slot frees, with abort and timeout rejection.
- Implement write-step agent gate invocations still refuse when the slot is held and settle `gate_invocation_refused` with cause `slot_contention`.
