# Reconcile lost run routes

## Problem

When a draining private endpoint disappears, observation clears its live IDs and stops. A non-terminal row left by a dead owner becomes silently not-live without entering guarded reconciliation and recovery, and a still-live recorded owner may later die after an initial guard refusal.

## Behavior

Confirmed owner-route loss immediately withdraws route authority and public liveness, then invokes guarded reconciliation and recovery. A still-live recorded owner is never claimed; if it later dies, bounded retry reaches the existing recovery path.

## Decisions

- Declare route loss only when the liveness probe reports absent or stale, not when a list, forwarded request, or stream times out; rules out reclaiming work from a busy reachable owner.
- Withdraw the lost route before reconciliation begins; rules out reporting stale ownership while recovery evaluates or claims the row.
- Reuse owner-identity-guarded reconciliation and recovery rather than treating endpoint loss alone as proof of death; rules out two live processes executing one run when a socket disappears transiently.
- Keep an owner-liveness guard refusal non-live and schedule bounded reconciliation retry until terminal settlement or confirmed recovery; rules out leaving a later-dead recorded owner unrecovered.
- Keep reconciliation failure non-live and leave unrelated requests responsive; rules out optimistic liveness or stable-daemon blockage after ownership can no longer be reached.

## Tasks

- Surface confirmed route loss from drain observation after withdrawing its ownership snapshot.
- Trigger guarded reconciliation and retry without blocking unrelated stable-daemon requests.
- Cover dead-owner recovery, still-live-owner refusal then later death, transient failures, and reconciliation failure.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-run-route-loss.test.ts` proves confirmed route loss withdraws the draining row before invoking dead-owner reconciliation and redrives an eligible run only after guarded settlement; it fails against the pre-fix clear-and-stop observer.
- [ ] `v2/src/daemon/daemon-run-route-loss.test.ts` proves an unreachable route whose recorded owner is still alive reports the run non-live without resume, force claim, or durable settlement, then retries recovery after that owner dies; it fails against the pre-fix one-shot clear-and-stop observer.
- [ ] `v2/src/daemon/daemon-run-route-loss.test.ts` proves a transient list, routed-request, or stream failure while the endpoint remains live retains ownership and does not start reconciliation.
- [ ] `v2/src/daemon/daemon-run-route-loss.test.ts` proves reconciliation failure leaves the stale route withdrawn and the daemon responsive to unrelated requests.
- [ ] `v2/src/daemon/daemon-reconciliation.test.ts` stays green (dead-owner settlement and recovery safety unchanged).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/daemon-host.md` — document route-loss detection, immediate withdrawal, guarded reconciliation/retry, public loss semantics, and failure behavior.
- `v2/docs/v1-behaviors.md` — record that lost draining routes never remain live or bypass dead-owner safety.
