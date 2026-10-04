# 00 - TUI log resolves across live keyed daemons

## Problem

`jarvis tui log <run-id>` passes only the invoking digest's socket to the tail client, so the operator cannot follow a run owned by another live keyed daemon — the same single-socket blindness `run log` had before cross-daemon resolution shipped.

## Decisions

- Wire `discoverLiveDaemonSockets` into the `jarvis tui log` path the same way bare `jarvis tui` does; rules out a second enumeration seam.
- Resolve the owning live daemon for the run ID across discovered sockets with the same `isLive` owner preference the TUI run table uses; rules out requiring the operator to know which digest owns the run.
- Query set is `discoverLiveDaemonSockets` results ∪ invoking digest socket; rules out skipping the invoking socket when discovery is empty.
- Skip a socket that fails during owner lookup; rules out one dead socket blocking resolution on a live peer.
- When the run ID is absent on every queried daemon, open the tail on the invoking digest's socket and surface the same outcome as today's single-socket path; rules out a new cross-daemon not-found message or exit code.
- When no daemon is live at all, surface `unavailable` feedback and exit `1`; rules out changing the no-live-daemon path.
- No new subcommand or flag; rules out `tui log --all-daemons`.
- When only the invoking digest's daemon is live, `jarvis tui log` output stays byte-identical to today; rules out changing solo-daemon rendering.

## Task checklist

- [ ] Extend `RunTuiLogFollowDeps` with the `socketDiscovery` seam (same shape as `RunTuiEntryDeps`) and wire it from `runTuiCommand` for the `log` subcommand.
- [ ] Before `connectTuiLogTail`, discover live sockets, always include `deps.socketPath`, resolve the run's owning socket via per-daemon `list` with `isLive` owner preference, then tail through that socket.
- [ ] Tests in `v2/src/tui/tui-log-follow-entry.test.tsx`: run owned on a non-invoking live daemon tails through the owner socket with ink output asserted; solo-daemon replay unchanged; run absent on every daemon matches today's single-socket benign stream-end; guard-inversion negative case for owner resolution.
- [ ] Test in `v2/src/commands/tui.test.ts` that `jarvis tui log` hands the follow entry the discovery seam alongside the invoking socket path.
- [ ] Update operator and behavior docs listed below.

## Acceptance criteria

- [x] `jarvis tui log <run-id>` tails a run owned by a live daemon on a socket other than the invoking digest's; a test in `v2/src/tui/tui-log-follow-entry.test.tsx` fails against the current single-socket path.
- [x] `v2/src/tui/tui-log-follow-entry.test.tsx` "replays fixture records in arrival order with per-kind fields" stays green when only the invoking digest's daemon is live.
- [x] `v2/src/tui/tui-log-follow-entry.test.tsx` "unavailable daemon records unavailable feedback, exits 1, and does not open a tail stream" stays green.
- [x] When the run ID is on no live daemon, `jarvis tui log` surfaces the same outcome as today's single-socket path; `tui-log-follow-entry.test.tsx` "immediate benign stream-end yields zero event lines and exits 0" stays green for the absent-run case.
- [x] Inverting the owner-resolution guard fails a test in `v2/src/tui/tui-log-follow-entry.test.tsx`.
- [x] Cross-daemon coverage asserts rendered ink output, not just view-model state.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — `jarvis tui log` reads across live keyed daemons.
- `v2/docs/write-behavior.md` — `jarvis tui log` resolves across live keyed daemons; correct any claim that log follow is scoped to the invoking digest.
- `v2/docs/v1-behaviors.md` — record cross-daemon `jarvis tui log` resolution.
