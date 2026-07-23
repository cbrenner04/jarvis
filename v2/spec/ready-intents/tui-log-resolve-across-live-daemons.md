---
name: tui-log-resolve-across-live-daemons
---

# `jarvis tui log` resolves runs across live keyed daemons

## Problem

`jarvis tui log <run-id>` passes only the invoking digest's socket to the tail client, so the operator cannot follow a run owned by another live keyed daemon — the same single-socket blindness `run log` had before cross-daemon resolution shipped.

## Decisions

- Wire `discoverLiveDaemonSockets` into the `jarvis tui log` path the same way bare `jarvis tui` does; rules out a second enumeration seam.
- Resolve the owning live daemon for the run ID across discovered sockets with the same owner preference the run table uses; rules out requiring the operator to know which digest owns the run.
- Query set is `discoverLiveDaemonSockets` results ∪ invoking digest socket; rules out skipping the invoking socket when discovery is empty.
- Skip a socket that fails during owner lookup; rules out one dead socket blocking resolution on a live peer.
- When the run ID is absent on every queried daemon, surface the same tail failure as today's single-socket path; rules out a new cross-daemon not-found message.
- When no daemon is live at all, surface `unavailable` feedback and exit `1`; rules out changing the no-live-daemon path.
- No new subcommand or flag; rules out `tui log --all-daemons`.
- When only the invoking digest's daemon is live, `jarvis tui log` output stays byte-identical to today; rules out changing solo-daemon rendering.

## Acceptance criteria

- [ ] `jarvis tui log <run-id>` tails a run owned by a live daemon on a socket other than the invoking digest's; a test in `v2/src/tui/tui-log-follow-entry.test.tsx` fails against the current single-socket path.
- [ ] `v2/src/tui/tui-log-follow-entry.test.tsx` stays green when only the invoking digest's daemon is live.
- [ ] When no daemon is live at all, `jarvis tui log` records `unavailable` feedback, exits `1`, and does not open a tail stream; `tui-log-follow-entry.test.tsx` "unavailable daemon records unavailable feedback, exits 1, and does not open a tail stream" stays green.
- [ ] When the run ID is on no live daemon, the command surfaces the same failure as today's single-socket path.
- [ ] Inverting the owner-resolution guard fails a test in `v2/src/tui/tui-log-follow-entry.test.tsx`.
- [ ] Coverage asserts rendered ink output, not just view-model state.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — `jarvis tui log` reads across live keyed daemons.
- `v2/docs/write-behavior.md` — `jarvis tui log` resolves across live keyed daemons.
- `v2/docs/v1-behaviors.md` — record cross-daemon `jarvis tui log` resolution.

## Prerequisites

- Live digest-keyed socket discovery with health-probe liveness under `JARVIS_HOME`.
- The TUI run table discovers and aggregates live daemon sockets.
