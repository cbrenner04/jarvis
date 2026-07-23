---
name: tui-monitor-evict-failing-invoking-client
---

# TUI monitor evicts a failing invoking-socket client

## Problem

The monitor force-adds `deps.socketPath` to the live socket set every refresh tick, so pruning can never drop it and reconnection only runs for sockets absent from the client map. When the daemon behind the invoking socket dies and a new one binds the path, the stale `TuiDaemonClient` stays forever — `list()` failures are swallowed and that daemon's runs quietly vanish from the table.

## Decisions

- Treat the invoking socket like any other discovered socket for pruning; rules out the unconditional force-add at `tui-entry.tsx:214` as a permanent eviction exemption.
- Evict the invoking-socket client when its `list()` RPC fails so the next refresh tick can open a fresh connection; rules out retaining a stale invoking client until process exit.
- Non-invoking sockets keep today's per-connection `list()` failure skip; rules out evicting discovered sockets on transient `list()` errors.
- A daemon that has genuinely exited and left no socket remains ordinary eviction, not an error; rules out treating socket absence as a monitor failure.
- Out of scope: a reconnecting-state banner and backoff for the run table; rules out expanding this slice into table-level reconnect UX.
- Out of scope: revision-mismatch refusal on reconnect; rules out adding dispatch-revision guards the TUI path has never had.

## Acceptance criteria

- [ ] A monitor client for the invoking socket whose `list()` RPC begins failing is evicted and replaced on a later refresh tick, and the table again includes that daemon's runs; a test in `v2/src/tui/tui-entry.test.tsx` fails against the current force-add path.
- [ ] `tui-entry.test.tsx` "rediscovery: a daemon that exits removes its exclusive runs and keeps the monitor open" stays green; inverting the disappearance-eviction guard fails that test.
- [ ] `tui-entry.test.tsx` "multi-daemon: a connection whose list fails leaves the remaining daemons rendered and the monitor open" stays green.
- [ ] Coverage asserts rendered run-table output, not just view-model state.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — the run table's invoking-socket client is no longer exempt from eviction.
- `v2/docs/write-behavior.md` — invoking-socket client eviction matches other discovered sockets.
- `v2/docs/v1-behaviors.md` — record invoking-socket client eviction behavior.

## Prerequisites

- The TUI run table discovers and aggregates live daemon sockets on a periodic refresh tick.
- Exited daemons are removed from the client map when their socket disappears from live discovery (`tui-entry.test.tsx` "rediscovery: a daemon that exits removes its exclusive runs and keeps the monitor open").
