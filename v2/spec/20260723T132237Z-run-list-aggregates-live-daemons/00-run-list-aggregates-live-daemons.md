# 00 - Run list aggregates across live keyed daemons

## Problem

`jarvis run list` connects only to the invoking digest's socket. After a merge rotates the digest, the next `run list` targets an uncreated socket and exits `ENOENT` while in-flight runs remain on the previous daemon.

## Decisions

- `run list` queries every live keyed daemon under `JARVIS_HOME`, not only the invoking digest's socket; rules out `run list --all-daemons`.
- Query set is `discoverLiveDaemonSockets` results ∪ invoking digest socket (TUI `updateConnections` pattern); empty discovery still queries only the invoking socket; rules out discovery-only behavior that skips the invoking socket or exits 0 with no daemon contacted.
- Reuse `discoverLiveDaemonSockets` from the TUI path; rules out a second discovery implementation.
- Extract or share the TUI `mergeRunLists` helper (`isLive` owner preference); rules out a second merge implementation.
- Merge `list` rows by run ID, preferring the daemon that reports the row `isLive`; rules out duplicate rows from the shared durable store.
- Merged multi-daemon rows render in stable run-ID order; rules out nondeterministic interleaving across daemons.
- Skip a socket that fails to connect or whose `list` RPC fails; rules out one dead socket blanking the whole listing.
- When only the invoking digest's daemon is live, list output stays byte-identical to today; rules out changing solo-daemon rendering.
- `run wait`, `run log`, and other run subcommands stay on the single-socket path in this slice; rules out widening them here.
- Discovery reaches `run list` through a new optional `socketDiscovery` field on `CliDeps`
  (`v2/src/cli/deps.ts`), mirroring `RunTuiEntryDeps.socketDiscovery`; production defaults it to
  `discoverLiveDaemonSockets`. Rules out calling the real discovery directly from `run.ts`, which
  would leave the multi-socket path untestable.
- **The test harness already supports this — do not report it as a blocker.** A prior attempt
  claimed `withFixedUuid` + `makeIpcClient` cannot route responses across multiple concurrent
  clients. That is false: each client owns its own frame queue and its own transport `pending` map,
  so there is no cross-talk. `v2/src/commands/run.test.ts` (the `keyed socket` test that routes on
  `socketPath` and records into separate `sent` arrays) is a working two-client precedent in the
  file this spec edits. Prefer the single-string `withFixedUuid(ID, …)` form so every client's frame
  carries the same id; the array form is order-sensitive and unnecessary here.

## Task checklist

- [ ] Add optional `socketDiscovery` to `CliDeps`, defaulting to `discoverLiveDaemonSockets`.
- [ ] Extract or share the TUI run-list merge helper (`isLive` owner preference) for CLI reuse.
- [ ] Wire `run list` to discover live sockets, always include `deps.socketPath`, query each live daemon, merge, sort by `runId`, and render with `formatListRunRow`.
- [ ] Tests in `v2/src/commands/run.test.ts`: two live daemons with a run on the non-invoking one; duplicate durable rows deduped to the `isLive` owner; one unreachable socket skipped; solo-daemon output unchanged; guard-inversion negative cases. Route per-socket fakes through `deps.connectIpcClient(socketPath)`, as the existing keyed-socket test does.
- [ ] Update operator and architecture docs listed below.

## Acceptance criteria

- [ ] With two live keyed daemons under one home and a run live on the non-invoking one, `run list` includes that run; a test in `v2/src/commands/run.test.ts` fails against the current single-socket path.
- [ ] `run list` reports no duplicate run IDs when several daemons return the same durable row, and the rendered row is the one whose daemon reports it `isLive`.
- [ ] A socket present but unreachable is skipped and the remaining daemons' rows are still listed.
- [ ] When only the invoking digest's daemon is live, `run list` output is byte-identical to today.
- [ ] `run.test.ts` `read-only run list reports the missing daemon instead of starting one` stays green.
- [ ] Inverting each added guard (the liveness skip, the dedupe ownership rule) fails a test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — `run list` aggregates across live keyed daemons; correct any claim that list is scoped to the invoking digest.
- `v2/docs/write-behavior.md` — `run list` multi-daemon aggregation; `run wait` unchanged in this slice.
- `v2/docs/v2-architecture.md` — `run list` aggregates across live keyed daemons; correct single-daemon list claim.
- `v2/docs/operator-runbook.md` § Observe — a merge no longer blinds `run list`.
- `v2/docs/v1-behaviors.md` — record `run list` cross-daemon aggregation.
