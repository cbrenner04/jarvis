---
name: unified-pipeline-namespace-on-stable-daemon
---

# Unified pipeline namespace on the stable daemon

## Prerequisites

- Daemon upgrades hand off one stable public address: the incoming generation admits new work, the outgoing generation admits nothing new, finishes its owned work, and exits when idle.
- The stable daemon exposes each draining-generation run as live and routes run observation, waits, and controls to its authoritative owner; run logs need no routing (every generation shares `state/logs.jsonl`).

## Problem

Since #3863 a dead owner's pipeline is adopted, but `pipeline list` and pipeline-id prefix resolution still discover and compare keyed daemon sockets and require per-socket completeness. Repro 2026-09-13: `pipeline resume <prefix>` refused `pipeline_id_set_incomplete` while a predecessor socket was exiting, though `pipeline list` had just printed that prefix; the full id worked.

## Behavior

- The stable daemon answers `pipeline list` and full-id/prefix resolution from one namespace merging its own pipelines with its direct predecessor's, with no invoking-version socket completeness requirement.
- One canonical snapshot per id; derived state and dismissal semantics unchanged.
- Exact-id, ambiguous-prefix, unknown-id, and terminal-state refusals preserved independent of daemon generation.

## Acceptance criteria

- [ ] A regression test proves a prefix printed by `pipeline list` resolves after a source change when no invoking-version socket exists; it fails against the pre-fix completeness predicate.
- [ ] A test proves snapshots from incoming and draining generations are deduplicated behind the stable address with unchanged derived state and dismissal behavior.
- [ ] Tests preserve ambiguous-prefix, unknown-id, and terminal-state refusals without consulting public generation sockets.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — unified pipeline namespace.
- `v2/docs/v2-architecture.md` — stable-front-door pipeline resolution boundary.
- `v2/docs/v1-behaviors.md` — generation-transparent pipeline listing and prefix resolution.
