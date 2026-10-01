# 01 — Finalization gates wait for the slot

## Problem

Default ready gate, required integration, and repair re-gates in `publishCompletionArtifacts` spawn full-suite subprocesses without holding the daemon gate lease, bypassing the one-gate-per-daemon guarantee agent gates obey.

## Decisions

- Default ready gate, required integration, and each repair re-gate in `publishCompletionArtifacts` await `awaitGateInvocationLease` before spawn, release in `finally`, and re-acquire on each repair re-gate after the repair agent releases the prior hold; base-ref probes and scoped verifier runs stay outside the slot; rules out serializing probes or verifier spawns on the full-suite lease.
- Wait is bounded by `readyGateSubprocessTimeoutMs()` and aborted by the run signal; wait time does not consume the gate subprocess deadline (armed at spawn); rules out charging slot wait against the subprocess timeout budget.
- Slot-wait expiry throws `ReadyGateError` with `timedOut: true` and output naming the slot wait; rules out a new finalization failure kind for slot wait alone.
- When acquire did not resolve immediately, log `ready_gate_slot_wait` with `gate` and `waitedMs`; while queued, `jarvis run list` `message` shows `waiting for gate slot`; rules out silent queueing with no operator surfacing.

## Task checklist

- [ ] Wrap harness full-suite gate spawns in `publishCompletionArtifacts` (default ready, required integration, repair re-gates) with lease wait/release; keep probes and scoped verifier runs unleased.
- [ ] Slot-wait timeout and abort wiring; `ReadyGateError` on wait expiry.
- [ ] Run-log `ready_gate_slot_wait` and run-list message while queued.
- [ ] Regression tests in `ready-finalize.test.ts` and `run.test.ts`.

## Acceptance criteria

- [ ] `v2/src/execution/ready-finalize.test.ts` proves two concurrent `createReadyFinalizer` runs over a stubbed `asyncSubprocessRunner` never overlap gate spawns (max in-flight 1), required integration holds the lease, a held agent lease delays the finalization gate until released, and each repair re-gate re-acquires the slot after the repair agent releases the prior lease before spawn; fails against pre-fix code with unleased harness spawns (reachable on main today).
- [ ] `v2/src/execution/ready-finalize.test.ts` proves a non-immediate slot acquire logs `ready_gate_slot_wait` with `gate` and `waitedMs`; fails against pre-fix code with no slot wait logging (reachable on main today).
- [ ] `v2/src/commands/run.test.ts` proves `jarvis run list` `message` shows `waiting for gate slot` while finalization is queued on the slot; fails against pre-fix code with no slot-wait message (reachable on main today).
- [ ] `v2/src/execution/ready-finalize.test.ts` proves slot-wait expiry surfaces `ReadyGateError` with `timedOut: true` naming the slot wait; fails against pre-fix code with no slot wait (reachable on main today).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Concurrency — the slot covers harness finalization gates; finalization waits while agents refuse; document `ready_gate_slot_wait` and `waiting for gate slot`.
- `v2/docs/write-behavior.md` — finalization gate serialization and repair re-acquire on the shared slot.
- `v2/docs/v1-behaviors.md` — harness finalization shares the per-daemon full-suite gate slot.
