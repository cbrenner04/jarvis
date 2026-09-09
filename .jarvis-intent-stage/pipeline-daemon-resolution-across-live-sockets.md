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
- The resolver reports, per pipeline id, which discovered socket answers for it; rules out callers re-probing sockets per verb.
- Resolution never auto-starts a daemon; auto-start stays a caller decision made only when no discovered socket answers; rules out diagnosis causing the supersede it is diagnosing.
- Connection and RPC failures on individual sockets are skipped, not fatal, matching `queryDaemonListsFromSocketPaths` skip-on-failure; rules out one dead socket blanking the whole result.
- Exhausting every discovered socket for a pipeline id yields a structured not-found result naming the pipeline id, not a raw connect error; rules out callers having to interpret `ENOENT` strings.

## Acceptance criteria

- [ ] A test proves the resolver returns the owning socket for a pipeline id hosted on a daemon keyed by a digest other than the invoking one; it fails against the pre-fix code, where no such resolution exists.
- [ ] A test proves the resolver skips a socket whose connection or RPC fails and still returns the owner found on a later socket.
- [ ] A test proves the resolver returns a not-found result naming the pipeline id when no discovered socket owns it, and does not start a daemon.
- [ ] A test proves resolution issues no auto-start on any path.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — the socket discovery set is shared by the run and pipeline CLI paths.
- `v2/docs/v1-behaviors.md` — record that pipeline daemon resolution is no longer invoking-digest-only.

## Prerequisites

- `discoverLiveDaemonSockets` enumerates and liveness-probes keyed daemon sockets under `JARVIS_HOME`.
- `resolveDaemonListSocketPaths` merges discovered sockets with the invoking digest's socket for `run list`.
- Daemons answer a `pipeline_list` RPC returning pipeline snapshots with ids.
