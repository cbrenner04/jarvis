# 01 - TUI aggregates runs across live daemons

## Problem

`runTuiEntry` connects to one socket (`deps.socketPath`) and renders only that daemon's `list`. When a newer digest takes over dispatch, the operator's TUI shows the wrong daemon's live runs. All daemons share one SQLite state store, so each returns the same durable rows with its own `isLive` flags — connecting to several without dedupe would double every row.

## Decisions

- The entry holds one client per discovered live socket and merges their `list` results; rules out picking a single "best" daemon, which loses the other daemons' live runs.
- Dedupe by run ID: the owner is the daemon that reports the row `isLive`, else the first connection in discovery order that returned it; rules out arbitrary last-write-wins, which would steer through a daemon that does not own the run.
- Selection, `wait`, `pause`, `resume`, and `kill` dispatch to the selected run's owning connection; rules out broadcasting or using a fixed primary connection.
- Ownership is recomputed on each merge, and the merged row rendered is the owner's; rules out caching a first-seen route that goes stale when liveness moves.
- The socket set arrives through an injectable discovery seam on `RunTuiEntryDeps`, defaulting to the discovery from `00`; the `tui` command supplies it. `deps.socketPath` stays as the invoking digest's socket and is always included in the connect set even when discovery returns nothing, so a solo daemon behaves as today.
- A connection that fails to connect or whose `list` throws is skipped for that merge, leaving the other daemons rendered; rules out one unreachable daemon collapsing the view.
- `run list` and `run wait` keep using the single-socket dispatch path; rules out widening CLI commands into aggregators.

## Task checklist

- [ ] Extend `RunTuiEntryDeps` with the discovery seam and wire it from `runTuiCommand`.
- [ ] Replace the single `client` in `v2/src/tui/tui-entry.tsx` with a connection set plus a run-ID → owning-connection map produced by the merge.
- [ ] Route `wait` and the steering actions through the selected run's owner; keep existing selection, wait-token, and steering-feedback semantics.
- [ ] Tests in `v2/src/tui/tui-entry.test.tsx` over a fake view host and stub clients: two daemons returning the same durable rows render each run once; a run live on the second daemon is owned and steered there; one failing connection does not blank the view.
- [ ] Test in `v2/src/commands/tui.test.ts` that `jarvis tui` hands the entry the discovery seam alongside the invoking socket path.

## Acceptance criteria

- [ ] With two live daemons whose `list` results overlap, the monitor renders each run ID exactly once.
- [ ] A run reported `isLive` by one daemon is rendered from that daemon's row, and its `wait`, `pause`, `resume`, and `kill` calls reach that daemon and no other.
- [ ] Runs live on different daemons are visible together in one monitor.
- [ ] A connection whose `list` fails leaves the remaining daemons' runs rendered and the monitor open.
- [ ] With discovery returning no sockets, the TUI still connects to the invoking digest's socket and behaves as before.
- [ ] `run list` and `run wait` stay scoped to one daemon: the existing `v2/src/commands/run.test.ts` list and wait tests stay green.
- [ ] New tests in `v2/src/tui/tui-entry.test.tsx` and `v2/src/commands/tui.test.ts` covering the above fail against the pre-fix single-connection entry and pass after the change.
- [ ] Inverting each added guard (dedupe-by-run-ID, live-owner preference, per-connection failure skip, always-include invoking socket) makes at least one test fail; the dedupe and failure-skip negative cases prove the duplicate row and the aborted render are absent.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — § TUI: the monitor aggregates every live daemon, dedupes by run ID, and steers through the owning daemon, while `run list`/`run wait` stay single-daemon.
- `v2/docs/v2-architecture.md` — the TUI's multi-connection ownership boundary against single-socket CLI dispatch.
- `v2/docs/v1-behaviors.md` — record the TUI's multi-daemon run view as current behavior.
