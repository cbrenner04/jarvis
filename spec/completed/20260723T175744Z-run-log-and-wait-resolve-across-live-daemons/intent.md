---
name: run-log-and-wait-resolve-across-live-daemons
---

# `run log` and `run wait` resolve runs on non-invoking live daemons

## Problem

After a digest rotation, `run log` and `run wait` connect only to the invoking digest's socket, so the operator cannot tail or block on in-flight runs owned by a superseded daemon.

## Decisions

- `run log` and `run wait` route to the live keyed daemon that owns the run, using the same `isLive` owner preference as `run list` and the TUI; rules out requiring the operator to know which digest owns a run.
- Query set is `discoverLiveDaemonSockets` results ∪ invoking digest socket; empty discovery still probes only the invoking socket; rules out resolution that skips the invoking socket when discovery is empty.
- Skip a socket that fails to answer during owner lookup; rules out one dead socket blocking resolution on a live peer.
- When the run ID is absent on every queried daemon, surface the same `unknown_run` RPC error as today's single-socket path; rules out a new cross-daemon not-found message or exit code.
- Reuse `discoverLiveDaemonSockets`; rules out a second discovery implementation.
- No new subcommand or flag; rules out `run log --all-daemons`.
- When only the invoking digest's daemon is live, `run log` and `run wait` behavior stays byte-identical to today; rules out changing solo-daemon rendering.

## Acceptance criteria

- [ ] `run log` streams a run owned by a non-invoking live daemon; a test in `v2/src/commands/run.test.ts` fails against the current single-socket path.
- [ ] `run wait` resolves a run owned by a non-invoking live daemon; a test in `v2/src/commands/run.test.ts` fails against the current single-socket path.
- [ ] When only the invoking digest's daemon is live, `run log` and `run wait` output are byte-identical to today.
- [ ] When no daemon is live at all, the existing `run log` / `run wait` errors are unchanged.
- [ ] When the run ID is on no live daemon, `run log` and `run wait` surface the same `unknown_run` error as today's single-socket path.
- [ ] Inverting the owner-resolution guard fails a `run log` test and a separate `run wait` test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — `run log` and `run wait` resolve across live keyed daemons.
- `v2/docs/write-behavior.md` — remove the claim that `run wait` remains single-daemon scoped (`run list` updated in the prior slice).
- `v2/docs/v2-architecture.md` — `run log` and `run wait` resolve across live keyed daemons; correct single-daemon wait claim.
- `v2/docs/operator-runbook.md` § Observe — merge no longer blinds `run log` or `run wait`.
- `v2/docs/v1-behaviors.md` — record `run log` / `run wait` cross-daemon resolution.

## Prerequisites

- Live digest-keyed socket discovery with health-probe liveness under `JARVIS_HOME`.
- `run list` aggregates across live keyed daemons with `isLive` owner dedupe.
