# 00 - Evict failing invoking-socket client

## Problem

`updateConnections` force-adds `deps.socketPath` to the live socket set every refresh tick, so pruning can never drop the invoking client and reconnection only runs for sockets absent from the client map. When the daemon behind the invoking socket dies and a new one binds the path, the stale `TuiDaemonClient` stays forever — `list()` failures are swallowed and that daemon's runs quietly vanish from the table.

## Decisions

- Include `deps.socketPath` in the connect set only when discovery returns no sockets (solo fallback) or when discovery already lists that path; rules out the unconditional `allSockets.add(deps.socketPath)` at `tui-entry.tsx:214` that blocks pruning.
- Evict the invoking-socket client (close and remove from the map) when its `list()` RPC fails so the next refresh tick can `connectTuiDaemon` a fresh client; rules out retaining a stale invoking client until process exit.
- Non-invoking clients keep today's per-tick `list()` failure skip without eviction; rules out evicting discovered sockets on transient `list()` errors.
- Socket disappearance from live discovery remains ordinary client drop with no monitor error; rules out treating an exited daemon as a monitor failure.
- Out of scope: reconnecting-state banner or backoff for the run table; rules out table-level reconnect UX in this slice.
- Out of scope: revision-mismatch refusal on reconnect; rules out dispatch-revision guards the TUI path has never had.

## Task checklist

- [ ] Stop unconditionally force-adding `deps.socketPath` on every rediscovery tick; preserve solo-daemon fallback when discovery returns no sockets.
- [ ] On `list()` failure, evict only the client bound to `deps.socketPath`; leave other failing clients skipped for that merge.
- [ ] Add `tui-entry.test.tsx` coverage for invoking-socket stale-client recovery across refresh ticks.
- [ ] Update operator and behavior docs listed below.

## Acceptance criteria

- [x] `tui-entry.test.tsx` `"rediscovery: invoking socket list failure evicts stale client and reconnects"` fails against the pre-fix force-add path and passes after the change; the test drives a refresh where the invoking client's `list()` begins failing, then a replacement client succeeds, and asserts run-table line output via `monitorTextLines` (not only `view.monitorStates`).
- [x] `tui-entry.test.tsx` `"rediscovery: a daemon that exits removes its exclusive runs and keeps the monitor open"` stays green.
- [x] `tui-entry.test.tsx` `"multi-daemon: a connection whose list fails leaves the remaining daemons rendered and the monitor open"` stays green.
- [x] `tui-entry.test.tsx` `"multi-daemon: with discovery returning no sockets, the TUI still connects to the invoking digest socket and behaves as before"` stays green.
- [x] Inverting the invoking-socket `list()`-failure eviction guard makes `"rediscovery: invoking socket list failure evicts stale client and reconnects"` fail and proves the recovered runs are absent from run-table output.
- [x] Inverting the disappearance-only eviction guard makes `"rediscovery: a daemon that exits removes its exclusive runs and keeps the monitor open"` fail.
- [x] Inverting the non-invoking `list()` failure skip (evicting discovered sockets on `list()` error) makes `"multi-daemon: a connection whose list fails leaves the remaining daemons rendered and the monitor open"` fail.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — the run table's invoking-socket client is no longer exempt from eviction; a failing `list()` on that connection is dropped and reconnected on a later tick like other pruned sockets.
- `v2/docs/write-behavior.md` § TUI — invoking-socket inclusion is discovery-driven with empty-discovery fallback only; invoking-socket `list()` failure evicts the stale client for reconnect on the next tick; non-invoking `list()` failures remain skip-only.
- `v2/docs/v1-behaviors.md` — record invoking-socket client eviction on `list()` failure and discovery-driven pruning.
