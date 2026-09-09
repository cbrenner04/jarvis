# Pipeline daemon resolution walks every live keyed socket

## Problem

`jarvis run list` resolves daemons through `discoverLiveDaemonSockets` unioned with the invoking digest's socket (`resolveDaemonListSocketPaths`). Pipeline verbs have no equivalent seam: each can only talk to `deps.socketPath`, so a merge that rotates the launcher's digest key kills pipeline control with `connect ENOENT …daemon-<key>.sock` while the owning daemon is alive. `withRunClient` then auto-starts a daemon on the invoking digest, whose startup broadcasts `supersede` — diagnosing the outage causes it.

This subspec builds the resolution seam only. The pipeline verbs adopt it in later work; nothing calls it yet.

## Decisions

- The socket set is the one `run list` uses (discovered live sockets unioned with the invoking digest's socket); rules out a second, divergent discovery rule for the pipeline surface.
- Ownership is established with the `pipeline_owner` RPC, never with `pipeline_list` membership.
- The input is a resolved full pipeline id; prefix resolution stays with the verbs. Rules out resolving a prefix per-daemon and racing distinct ids.
- An `owner` witness selects that socket. Concurrent `owner` witnesses are not reachable today — the store guards `ownerIdentity` so at most one daemon can hold it for an active pipeline — so `pipeline_owner_conflict` (naming the pipeline and sorted claimant paths, with no control RPC issued) is a defensive guard against that guarantee weakening, not a fix for a currently-reachable defect.
- With no `owner` witness but one or more `durable_state` endpoints, the resolver sorts the answering socket paths itself and selects the lexicographically first, independent of the order sockets were queried or answered in; any answering daemon reads the same shared store.
- The resolved result names the witness kind (`owner` or `durable_state`) alongside the socket path and pipeline id, not a bare path. `durable_state` is a read-routing answer; whether and how a verb may issue a mutating RPC against a `durable_state` endpoint, and whether it should re-assert ownership first, is deferred to first consumer. Rules out a bare-path result silently licensing a mutating RPC against an endpoint that never claimed live ownership.
- An `active` pipeline with only `not_owner` witnesses yields `pipeline_no_live_owner`, whose recovery is `jarvis daemon start`, then retry, so startup reconciliation settles the dead owner. That recovery deliberately invokes the same supersede-broadcasting startup that resolution itself never triggers: it's operator-initiated after being told the owner is dead, and reconciling a dead owner is what startup is for — unlike an auto-start firing silently on every failed connect while an operator is merely diagnosing.
- Resolution never auto-starts a daemon on any path, including `pipeline_no_live_owner`; rules out diagnosis triggering the supersede it is diagnosing.
- Per-socket connect and RPC failures are skipped, not fatal, matching `queryDaemonListsFromSocketPaths` skip-on-failure; rules out one dead socket blanking the result. A socket that accepts a connection but never responds is treated as a failure via a per-socket timeout, not an indefinite wait — rules out a silent hang stalling resolution on exactly the path an operator hits when things are broken.
- Exhausting every socket with only `not_found` yields `pipeline_not_found`; exhausting them with no answer at all yields `pipeline_daemon_unavailable`. Neither result exposes a raw connect error, which is how `ENOENT …daemon-<key>.sock` reached operators.
- Deferred to first consumer: how each verb renders these results, whether any of them is retried, and how a verb re-asserts ownership before writing through a `durable_state` result — pin when a caller needs it.

## Task checklist

- [ ] Add the resolver module reusing `resolveDaemonListSocketPaths` and the `pipeline_owner` RPC, with its own durable-state sort and a per-socket connect/response timeout.
- [ ] Cover owner routing, witness-kind tagging, skip-on-failure (including a hung socket), durable-state selection, conflict, absence, unavailability, and no-auto-start with tests.
- [ ] Update `v2/docs/daemon-host.md`.
- [ ] Update `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] `v2/src/daemon/pipeline-daemon-resolution.test.ts`'s `resolves a non-invoking active owner` regression proves a `pipeline_owner` witness on a discovered non-invoking socket routes there and the result names it as an `owner` witness; it fails against the pre-fix code, where no such resolution exists.
- [x] `v2/src/daemon/pipeline-daemon-resolution.test.ts`'s `skips a failed socket before a later owner witness` regression proves per-socket connect failure, RPC failure, and a connect-then-never-responds socket (via the per-socket timeout) are all non-fatal and skipped before a later owner witness is reached.
- [x] `v2/src/daemon/pipeline-daemon-resolution.test.ts`'s `selects a durable-state endpoint or reports a dead active owner` regression proves terminal and reconciled-interrupted pipelines, answered from sockets fed in non-sorted order, select the lexicographically first answering endpoint (proving the resolver's own sort, not input order) and name it as a `durable_state` witness, while an active pipeline with no owner witness returns `pipeline_no_live_owner` carrying `jarvis daemon start`, then retry.
- [x] `v2/src/daemon/pipeline-daemon-resolution.test.ts`'s `refuses duplicate owner witnesses` test proves two injected `owner` witnesses — a defensive guard, since the store already prevents this — return `pipeline_owner_conflict` with sorted claimant paths and that no control RPC is issued.
- [x] `v2/src/daemon/pipeline-daemon-resolution.test.ts`'s `reports absent and unavailable pipelines` regression proves an id absent from every socket returns `pipeline_not_found`, all-failed sockets return `pipeline_daemon_unavailable`, and neither result carries a raw connect error string.
- [x] `v2/src/daemon/pipeline-daemon-resolution.test.ts`'s `never auto-starts` regression proves an injected daemon-start seam is never invoked on any result path.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/daemon-host.md` — record that the discovered-plus-invoking socket set is shared by the run and pipeline CLI paths, and that pipeline resolution never auto-starts a daemon.
- `v2/docs/v1-behaviors.md` — record that pipeline daemon resolution is no longer invoking-digest-only.
