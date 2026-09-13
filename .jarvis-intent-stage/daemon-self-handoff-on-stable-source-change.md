---
name: daemon-self-handoff-on-stable-source-change
---

# Hand off a stale daemon generation automatically

## Prerequisites

- A live daemon can cut admission, disclose its private endpoint, release the stable public address, and drain already-admitted work without interrupting it.
- A successor startup failure before readiness makes the incumbent reclaim the stable public address and resume normal admission while its previously admitted work continues uninterrupted.

## Primary implementation surface

- Daemon runtime source-change monitoring and self-upgrade orchestration: executable digest sampling, handoff attempt state, daemon startup wiring, and process-log cause reporting.

## Problem

A daemon captures its executable digest at startup and status can compare it with the current tree, but only a client request can start another generation. A source merge therefore leaves the old code serving indefinitely until an operator intervenes.

## Behavior

- The daemon periodically samples the executable tree digest and initiates its existing generation handoff without a client request after the same digest differs from the loaded digest on two consecutive samples.
- One divergent sample followed by the loaded digest, or by a different divergent digest, does not trigger handoff.
- At most one self-handoff attempt runs at a time; another source change is left for the successor's next sampling cycle.
- The incumbent records the loaded and observed digests in its process log when it initiates self-handoff.

## Decisions

- Reuse `getExecutableTreeDigest`; do not add file watching or another version identity.
- Keep sampling and successor startup asynchronous so IPC and admitted work remain responsive.
- Reuse the existing cutoff, private-endpoint drain, and outgoing-generation exit protocol unchanged.
- Treat successor readiness failure as a completed attempt only after rollback restores incumbent service; do not kill or restart in place.

## Acceptance criteria

- [ ] A regression test changes the observed executable digest to the same divergent value for two consecutive samples and proves handoff starts without any client request; it fails against the pre-fix runtime where no daemon-owned trigger exists.
- [ ] A test proves one divergent sample followed by the loaded digest does not initiate handoff.
- [ ] A test proves two different divergent samples do not initiate handoff until one value is observed twice consecutively.
- [ ] A test proves an in-flight run admitted before self-handoff completes normally under the outgoing generation without interruption.
- [ ] A test proves no second handoff starts while the first is in flight.
- [ ] A test proves successor startup failure restores incumbent admission through the prerequisite rollback behavior.
- [ ] A test proves the initiating generation's process log records both the loaded and observed digests as the self-handoff cause.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — autonomous digest sampling, two-sample stability, bounded handoff, drain preservation, rollback, and recorded cause.
- `v2/docs/operator-runbook.md` — merged executable changes take effect after automatic handoff and drain; explain `daemon status` loaded/current output during convergence.
- `v2/docs/v1-behaviors.md` — record autonomous v2 daemon generation replacement.
