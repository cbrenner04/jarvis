---
name: pipeline-restart-reconciliation
---

# Pipeline restart reconciliation

Slice 2c of [per-project pipelines](../per-project-pipelines-brief.md).

## Prerequisites

- Daemon-owned pipeline execution records durable pipeline and stage lifecycle state
- Daemon startup reconciles non-terminal run rows by admitting-process identity before serving IPC

## Problem

A daemon can exit while a pipeline stage is active. Startup must not leave that pipeline
non-terminal with no owner or silently discard its last known stage.

## Decisions

- Pipeline rows carry admitting-process ownership sufficient for the existing dead-incarnation predicate; rules out treating every non-terminal pipeline as orphaned.
- Startup reconciliation settles an orphaned active pipeline and its active stage as interrupted while preserving completed and undispatched stages; rules out silent deletion or fabricated completion.
- Boundary-terminal pipelines remain unchanged during reconciliation; rules out restart overwriting an already-settled result.
- Reconciliation finishes before the daemon accepts new pipeline work; rules out racing new admission against ownerless state.
- Deferred to first consumer: automatic restart admission — pin when stage-scoped pipeline resume exists.

## Acceptance criteria

- [ ] Reopening the store under a simulated replacement daemon identifies a non-terminal pipeline owned by a dead prior incarnation.
- [ ] Startup settles that pipeline and its active stage as interrupted, preserves prior completed stages, and leaves later stages undispatched.
- [ ] No reconciled pipeline remains non-terminal without a live owner.
- [ ] A pipeline owned by a still-live process is unchanged.
- [ ] Completed and failed pipelines are unchanged.
- [ ] The daemon does not accept new pipeline work until reconciliation completes or startup fails.
- [ ] A regression case in `v2/src/daemon/daemon-reconciliation.test.ts` covers dead-owner settlement and live-owner preservation, fails before this change, and passes after it; inverting either ownership or terminal-status guard makes it fail.

## Documentation updates

- `v2/docs/daemon-host.md` — pipeline ownership predicate, restart ordering, and interrupted settlement.
- `v2/docs/state-store.md` — pipeline owner identity and reconciliation operations.
