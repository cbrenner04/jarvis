# 00 - Owned gate-invocation lease

## Problem

`v2/src/execution/write-loop.ts` keeps the gate slot as `let agentGateSlotHeld = false` with an exported unconditional `releaseAgentGateInvocationSlot()`: any caller can free another lane's hold, the cap constant is decorative (the implementation is a boolean, so `2` changes nothing), and `settleFinalizationRepair` returns without releasing a gate its tracker acquired. Only the ordinary-settle clobber path is pinned today (`an iteration without a gate does not release another lane's held slot`).

## Decisions

- Acquisition returns an owned lease (`GateInvocationLease` with a single `release()`), tracked in a module-level set of live leases; `release()` is idempotent and removes only its own lease; rules out a bare global boolean and any release path that does not hold a lease.
- Admission is a pure predicate `gateInvocationAdmits(heldCount, limit)` evaluated at the acquire site with `MAX_CONCURRENT_AGENT_GATE_INVOCATIONS`, so the constant is load-bearing and the predicate is unit-testable at other limits without a production seam; rules out an exported cap the implementation ignores and rules out a `*ForTest` limit override.
- The iteration tracker owns its lease: it releases on shell-tool completion, on iteration loss, and on every finalization-repair exit; `settleFinalizationRepair` receives the tracker like `settleBoundedIteration` does; rules out the repair-path leak the old clobber masked.
- `releaseAgentGateInvocationSlot` and `tryAcquireAgentGateInvocationSlot` are removed; tests hold and release leases through the public acquire API and never reset global state by fiat; rules out a test-only reset hook.
- Failure mode on lease exhaustion is unchanged: `gate_invocation_refused` per the landed budget spec.

## Tasks

- Replace the boolean slot with `acquireGateInvocationLease(): GateInvocationLease | undefined` over a live-lease set and `gateInvocationAdmits`.
- Thread the tracker into `settleFinalizationRepair` and release there.
- Rewrite the `gate invocation budget and settlement` fixtures in `write-loop.test.ts` to acquire and release leases instead of calling the removed reset.

## Acceptance criteria

- [x] `write-loop.test.ts` test `a lane that never acquired the slot cannot release it` proves that releasing a lease twice, and calling `release()` on one lane's lease while another lane's lease is live, leaves the other lane's hold intact; it fails against the current unconditional `releaseAgentGateInvocationSlot`.
- [x] `write-loop.test.ts` test `gateInvocationAdmits bounds admission by the limit it is given` proves `gateInvocationAdmits(0, 2)` and `(1, 2)` admit and `(2, 2)` refuses, and that `acquireGateInvocationLease` refuses once `MAX_CONCURRENT_AGENT_GATE_INVOCATIONS` leases are live; it fails against the current boolean.
- [x] `write-loop.test.ts` test `a finalization-repair iteration releases the gate lease it acquired` proves the lease is free after a repair-policy iteration settles on each exit path (settled, aborted, threw); it fails against the current `settleFinalizationRepair`.
- [x] `write-loop.test.ts` tests `serializes concurrent gate invocations so only one lane proceeds` and `an iteration without a gate does not release another lane's held slot` stay green.
- [x] `bun run typecheck`, `bun run check`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — lease ownership and the three release points.
- `v2/docs/operator-runbook.md` — § Concurrency: the one-gate-per-daemon guarantee now holds by construction.
- `v2/docs/v1-behaviors.md` — update the gate-invocation serialization entry.
