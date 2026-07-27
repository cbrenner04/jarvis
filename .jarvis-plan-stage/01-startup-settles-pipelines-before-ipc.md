# Daemon startup settles orphaned pipelines before IPC

Slice 2c of [per-project pipelines](../per-project-pipelines-brief.md), daemon layer.

## Problem

The store sweep only settles orphaned pipelines when something calls it. Startup must run it
before the socket serves, or new pipeline work races state that has no live owner.

## Decisions

- Pipeline reconciliation runs inside the existing pre-IPC startup reconciliation block, alongside
  `reconcileOrphanedRuns`; rules out a lazy first-request or background sweep.
- A pipeline reconciliation failure aborts startup before IPC serves, matching run/log reconciliation
  failure handling; rules out serving with partially settled pipeline state.
- Startup settles orphans only; it does not re-dispatch or re-admit them. Deferred to first consumer:
  automatic restart admission — pin when stage-scoped pipeline resume exists.

## Acceptance criteria

- [ ] Starting the daemon runtime over a store holding a pipeline owned by a dead prior incarnation
      settles that pipeline and its active stage as interrupted, preserves its completed stages, and
      leaves its later stages undispatched.
- [ ] A pipeline owned by a still-live process, and a pipeline already in a terminal status, are
      unchanged across startup.
- [ ] No pipeline is left non-terminal with a dead or absent owner once startup completes.
- [ ] A pipeline reconciliation failure aborts startup and no IPC connection is accepted.
- [ ] No pipeline row is read or written by request handling before the sweep completes.
- [ ] `v2/src/daemon/daemon-reconciliation.test.ts` covers dead-owner settlement and live-owner
      preservation through daemon startup, fails against the pre-change daemon, and passes after.
- [ ] Inverting either the ownership guard or the terminal-status guard turns that regression RED,
      and removing the pre-IPC ordering makes the failure-aborts-startup case RED.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — pipeline ownership predicate, restart ordering relative to IPC, and
  interrupted settlement of orphaned pipelines and their active stages.
- `v2/docs/v1-behaviors.md` — no change; additive v2-only startup behavior.
