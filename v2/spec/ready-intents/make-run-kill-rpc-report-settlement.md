---
name: make-run-kill-rpc-report-settlement
---

# Make the run kill RPC report settlement

## Prerequisites

- Every gate and verifier subprocess group that can block run termination is durably associated with its owning run while in flight.

## Primary implementation surface

- Daemon: live-run termination and kill RPC outcome in `v2/src/daemon/`.

## Problem

The kill handler acknowledges an active run immediately after aborting its controller. Workflow settlement happens only after finalization quiesces, so a hung child leaves the row live indefinitely; `force: true` takes the same active-run path and cannot break the cycle.

## Behavior

- Plain kill signals every recorded gate/verifier process group before waiting up to the quiescence bound for durable settlement.
- Plain kill reports a non-settling outcome when the bound expires, including the durable row state and each surviving child PID with its current parent PID.
- Force kill settles the named non-terminal row durably `killed` even when workflow quiescence does not finish, while reporting any child still observed after the termination attempt.
- A successful kill outcome means the named row is durably `killed`, not merely that abort was requested.

## Decision ledger

- Reserve successful settlement for an observed durable `killed` row; rules out an acknowledgement-only `{ ok: true }` result while the row remains live.
- Signal recorded process groups before any quiescence wait; rules out waiting on the child termination is intended to reap.
- Preserve the bounded controlled-loss wait for plain kill; rules out either unbounded RPC latency or immediate durability that discards the checkpoint opportunity.
- Let force settlement win over unfinished quiescence and preserve later guarded cleanup; rules out routing active `force: true` through the same inert deferred-settlement path as plain kill.
- Report observed PID and PPID together for surviving children; rules out forcing the operator to reconstruct whether the child is daemon-parented or orphaned.
- Preserve terminal sibling rows and settle only the named run row; rules out force-killing an entire workflow invocation durably.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-workflow-start.test.ts` proves plain kill of a workflow held by a non-quiescing child waits only to the configured bound, returns a non-settling outcome, and leaves no successful acknowledgement; it fails against the pre-fix immediate `{ ok: true }` response.
- [ ] A daemon run-control regression proves recorded gate/verifier process groups are signalled before the settlement wait begins; it fails against the pre-fix kill handler that only aborts the controller.
- [ ] `v2/src/daemon/daemon-workflow-start.test.ts` proves `force: true` durably settles the named active row `killed` when workflow quiescence remains pending; it fails against the pre-fix active-run branch that defers settlement.
- [ ] A daemon run-control regression proves a non-settling plain outcome and a force-settled partial outcome include each surviving child PID and current PPID; it fails against the pre-fix message-free result.
- [ ] Existing terminal-winner and named-row-only kill tests stay green in `v2/src/daemon/daemon-workflow-start.test.ts` and `v2/src/daemon/daemon-start-list.test.ts`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — kill RPC settlement outcomes, pre-wait process-group signalling, bounded plain refusal, and active force settlement.
- `v2/docs/write-behavior.md` — controlled-loss quiescence versus force settlement when a finalization child does not unwind.
- `v2/docs/v1-behaviors.md` — record the daemon-side honest kill contract and pre-quiescence process-group termination.
