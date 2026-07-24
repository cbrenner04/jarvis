---
name: run-list-aggregates-live-daemons
---

# `run list` aggregates across live keyed daemons

## Problem

`jarvis run list` connects only to the invoking digest's socket. After a merge rotates the digest, the next `run list` targets an uncreated socket and exits `ENOENT` while in-flight runs remain on the previous daemon.

## Decisions

- `run list` queries every live keyed daemon under `JARVIS_HOME`, not only the invoking digest's socket; rules out `run list --all-daemons`.
- Query set is `discoverLiveDaemonSockets` results ∪ invoking digest socket (TUI `updateConnections` pattern); empty discovery still queries only the invoking socket; rules out discovery-only behavior that skips the invoking socket or exits 0 with no daemon contacted.
- Reuse `discoverLiveDaemonSockets` from the TUI path; rules out a second discovery implementation.
- Extract or share the TUI `mergeRunLists` helper (`isLive` owner preference); rules out a second merge implementation.
- Merge `list` rows by run ID, preferring the daemon that reports the row `isLive`; rules out duplicate rows from the shared durable store.
- Merged multi-daemon rows render in stable run-ID order; rules out nondeterministic interleaving across daemons.
- Skip a socket that fails to answer; rules out one dead socket blanking the whole listing.
- When only the invoking digest's daemon is live, list output stays byte-identical to today; rules out changing solo-daemon rendering.

## Acceptance criteria

- [ ] With two live keyed daemons under one home and a run live on the non-invoking one, `run list` includes that run; a test in `v2/src/commands/run.test.ts` fails against the current single-socket path.
- [ ] `run list` reports no duplicate run IDs when several daemons return the same durable row, and the rendered row is the one whose daemon reports it `isLive`.
- [ ] A socket present but unreachable is skipped and the remaining daemons' rows are still listed.
- [ ] When only the invoking digest's daemon is live, `run list` output is byte-identical to today.
- [ ] `run.test.ts` `read-only run list reports the missing daemon instead of starting one` stays green (no-daemon error unchanged).
- [ ] Inverting each added guard (the liveness skip, the dedupe ownership rule) fails a test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — `run list` aggregates across live keyed daemons; correct any claim that list is scoped to the invoking digest.
- `v2/docs/write-behavior.md` — `run list` multi-daemon aggregation; `run wait` unchanged in this slice.
- `v2/docs/v2-architecture.md` — `run list` aggregates across live keyed daemons; correct single-daemon list claim.
- `v2/docs/operator-runbook.md` § Observe — a merge no longer blinds `run list`.
- `v2/docs/v1-behaviors.md` — record `run list` cross-daemon aggregation.

## Prerequisites

- Live digest-keyed socket discovery with health-probe liveness under `JARVIS_HOME`.
