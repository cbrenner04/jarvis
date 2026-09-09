---
name: pipeline-daemon-resolution-across-live-sockets
---

# Pipeline daemon resolution walks every live keyed socket, not just the invoking digest

## Problem

`jarvis run list` resolves its daemons through `discoverLiveDaemonSockets` plus the invoking digest's socket (`resolveDaemonListSocketPaths` in `v2/src/daemon/query-daemon-lists-from-sockets.ts`). No equivalent resolution seam exists for pipeline RPCs, so every pipeline verb can only talk to `deps.socketPath`. A merge that touches source rotates the launcher's digest key and pipeline control dies with `connect ENOENT …daemon-<key>.sock` while the daemon owning the work is alive and answering.

Worse, `withRunClient` auto-starts a daemon on the invoking digest when the connection fails, and a fresh daemon broadcasts `supersede` to the peers — so diagnosing the outage causes it.

This intent builds the resolution seam only; the pipeline verbs adopt it in later intents.

## Decisions

- Resolution reuses the same socket set `run list` uses (live discovered sockets plus the invoking digest's socket); rules out a second, divergent discovery rule for the pipeline surface.
- The resolver establishes ownership with a `pipeline_owner` RPC, not `pipeline_list`. Given a resolved full id, it returns `{kind:"owner", pipelineId}` only when the daemon's current identity is the durable owner of an active pipeline; `{kind:"durable_state", pipelineId}` for a terminal or reconciled-interrupted pipeline; `{kind:"not_owner", pipelineId}` for another active owner; and `{kind:"not_found", pipelineId}` when absent. A snapshot containing the id is never an ownership claim.
- Any answering daemon may return `durable_state`; the resolver selects the lexicographically first socket path among those endpoints. An active pipeline with no owner witness is `pipeline_no_live_owner`, and the exact recovery is `jarvis daemon start`, then retry so startup reconciliation can settle the dead owner.
- Multiple `{kind:"owner"}` witnesses are `pipeline_owner_conflict`, naming the pipeline and sorted claimant paths; resolution issues no control RPC. Multiple durable-state endpoints use the lexicographically first path.
- Resolution never auto-starts a daemon; neither owner lookup nor a `pipeline_no_live_owner` result invokes daemon startup; rules out diagnosis causing the supersede it is diagnosing.
- Connection and RPC failures on individual sockets are skipped, not fatal, matching `queryDaemonListsFromSocketPaths` skip-on-failure; rules out one dead socket blanking the whole result.
- Exhausting every discovered socket for an absent id yields structured `pipeline_not_found` naming the pipeline. Exhausting them without an answer yields `pipeline_daemon_unavailable`; neither result exposes a raw connect error.

## Acceptance criteria

- [ ] `v2/src/daemon/pipeline-daemon-resolution.test.ts`'s `resolves a non-invoking active owner` regression proves a `pipeline_owner` witness routes there; it fails against the pre-fix code, where no such resolution exists.
- [ ] `v2/src/daemon/pipeline-daemon-resolution.test.ts`'s `skips a failed socket before a later owner witness` regression proves per-socket failure is non-fatal.
- [ ] `v2/src/daemon/pipeline-daemon-resolution.test.ts`'s `selects a durable-state endpoint or reports a dead active owner` regression proves terminal and reconciled-interrupted pipelines select the lexicographically first endpoint, while a dead active owner returns `pipeline_no_live_owner` with `jarvis daemon start`, then retry.
- [ ] `v2/src/daemon/pipeline-daemon-resolution.test.ts`'s `refuses duplicate owner witnesses` regression proves sorted claimants return `pipeline_owner_conflict` without issuing a control RPC.
- [ ] `v2/src/daemon/pipeline-daemon-resolution.test.ts`'s `reports absent and unavailable pipelines` regression proves an absent id returns `pipeline_not_found`, all failed sockets return `pipeline_daemon_unavailable`, and neither starts a daemon.
- [ ] `v2/src/daemon/pipeline-daemon-resolution.test.ts`'s `never auto-starts` regression proves resolution issues no auto-start on every result path.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — the socket discovery set is shared by the run and pipeline CLI paths.
- `v2/docs/v1-behaviors.md` — record that pipeline daemon resolution is no longer invoking-digest-only.

## Prerequisites

- `discoverLiveDaemonSockets` enumerates and liveness-probes keyed daemon sockets under `JARVIS_HOME`.
- `resolveDaemonListSocketPaths` merges discovered sockets with the invoking digest's socket for `run list`.
- Daemons expose durable pipeline ownership (`ownerIdentity`, active versus reconciled/terminal status) independently of `pipeline_list` snapshots.
