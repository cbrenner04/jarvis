# Daemon startup settles orphaned pipelines before IPC

Slice 2c of [per-project pipelines](../per-project-pipelines-brief.md), daemon layer.

## Problem

The store sweep only settles orphaned pipelines when something calls it. Startup must run it
before the socket serves, or new pipeline work races state that has no live owner.

## Decisions

- Pipeline reconciliation runs inside the existing pre-IPC startup reconciliation block, alongside
  `reconcileOrphanedRuns`; rules out a lazy first-request or background sweep.
- This subspec consumes `00`'s `pipelines.status` vocabulary (`'active'` / `'interrupted'`) as given;
  it does not redefine or restate it.
- A pipeline reconciliation failure aborts startup before IPC serves, matching run/log reconciliation
  failure handling; rules out serving with partially settled pipeline state.
- Startup settles orphans only; it does not re-dispatch or re-admit them. Deferred to first consumer:
  automatic restart admission — pin when stage-scoped pipeline resume exists.

## Acceptance criteria

- [ ] Starting the daemon runtime over a store holding a pipeline owned by a dead prior incarnation
      settles that pipeline and its active stage as interrupted, preserves its completed stages, and
      leaves its later stages undispatched.
- [ ] A pipeline owned by a still-live process is unchanged across startup.
- [ ] Starting the daemon runtime a second time over a store holding a pipeline already settled
      `interrupted` leaves that pipeline and its stages unchanged.
- [ ] No pipeline is left non-terminal with a dead or absent owner once startup completes.
- [ ] The pipeline reconciliation sweep completes before the daemon's socket accepts a connection.
- [ ] A pipeline reconciliation failure aborts startup and no IPC connection is accepted.
- [ ] `v2/src/daemon/daemon-reconciliation.test.ts` covers dead-owner settlement, live-owner
      preservation, and re-startup idempotence through daemon startup, fails against the pre-change
      daemon, and passes after.
- [ ] Removing the pre-IPC ordering (running the sweep after the socket is listening) turns the
      sweep-before-accept and failure-aborts-startup cases RED.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — pipeline ownership predicate, restart ordering relative to IPC (sweep
  before the socket accepts connections), and interrupted settlement of orphaned pipelines and their
  active stages.
- `v2/docs/v1-behaviors.md` — no change; additive v2-only startup behavior.
