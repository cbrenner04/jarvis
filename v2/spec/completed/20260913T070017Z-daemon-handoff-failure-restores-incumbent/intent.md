---
name: daemon-handoff-failure-restores-incumbent
---

# Restore the incumbent after a failed daemon handoff

## Prerequisites

- A live daemon can cut admission, disclose its private endpoint, release the stable public address, and drain already-admitted work without interrupting it.

## Primary implementation surface

- Daemon changeover transaction and stable-address ownership: `v2/src/daemon/daemon.ts` admission state and public listener lifecycle, plus `v2/src/daemon/daemon-lifecycle.ts` successor readiness failure.

## Problem

The handoff cutoff is irreversible. If an incumbent initiates changeover and the successor then dies or cannot bind, the incumbent remains drain-only with no admitting daemon at the public address.

## Behavior

- A successor startup failure before readiness makes the incumbent reclaim the stable public address and resume normal admission while its previously admitted work continues uninterrupted.

## Decisions

- Roll back only before successor readiness; a successful successor keeps ownership and the incumbent stays retiring.
- Restore the existing admission and listener contracts instead of restarting or killing the incumbent.
- Make rollback idempotent so overlapping failure signals cannot create multiple public listeners or reopen a successfully handed-off generation.

## Acceptance criteria

- [ ] A regression test drives a successor failure after admission cutoff and proves the incumbent again accepts new work at the stable public address; it fails against the pre-fix one-way retiring state.
- [ ] A test proves work admitted before the failed handoff remains live and reaches its normal outcome.
- [ ] A test proves a successful successor start does not restore the incumbent's admission or public listener.
- [ ] A test proves repeated rollback requests leave exactly one admitting public listener.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — failed-handoff ownership rollback and admission restoration.
- `v2/docs/v1-behaviors.md` — record the rollback-safe v2 generation-handoff behavior.
