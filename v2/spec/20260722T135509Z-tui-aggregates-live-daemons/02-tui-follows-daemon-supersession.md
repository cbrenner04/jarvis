# 02 - TUI follows daemon supersession without restart

## Problem

After `01`, the connection set is fixed at startup. A daemon started later (the common case: the operator rebuilds and dispatch moves to a new digest) stays invisible until the TUI is restarted, and a daemon that exits leaves a dead connection whose failing `list` degrades the view forever.

## Decisions

- Rediscovery runs on the existing monitor refresh tick; rules out a second timer with its own cadence.
- Newly discovered sockets are connected and merged into the next render; a connect failure is retried on the following tick rather than blacklisted, since a daemon mid-startup fails the first probe.
- Connections are dropped only when their socket is no longer discovered live; superseded-but-alive daemons are kept until they exit, so their in-flight runs stay visible.
- Dropping the connection that owned the selected run clears selection rather than exiting; rules out terminating the TUI when a daemon dies under it.
- Rediscovery failure leaves the current connection set intact for that tick; rules out collapsing to zero daemons on a transient directory-read error.

## Task checklist

- [ ] Rediscover live sockets inside the refresh path, adding clients for new sockets and closing clients for sockets no longer live.
- [ ] Preserve selection across ticks when the owning daemon survives; clear it (and its pending wait) when the owner is dropped.
- [ ] Close every remaining connection on exit.
- [ ] Tests in `v2/src/tui/tui-entry.test.tsx`: a socket appearing after startup contributes runs on the next tick; a daemon disappearing removes only its exclusive runs and keeps the monitor open; superseded and superseding daemons render together while both are live.
- [ ] Regression test in `v2/src/commands/tui.test.ts` driving `jarvis tui` through the entry with an injected view host and a discovery seam that grows between ticks, asserting the running TUI shows the new daemon's runs.

## Acceptance criteria

- [ ] A daemon that becomes live after the TUI started contributes its runs on a later refresh with no operator action.
- [ ] Runs on the superseded and superseding daemons are visible together while both daemons remain live.
- [ ] A daemon that exits has its connection closed and its exclusive runs removed; the monitor keeps rendering the remaining daemons and does not exit or stop refreshing.
- [ ] When the daemon owning the selected run is dropped, selection clears and the monitor stays open and interactive.
- [ ] Steering after supersession targets the daemon owning the selected run, not the daemon connected at startup.
- [ ] A rediscovery that fails leaves the previously connected daemons rendered.
- [ ] The regression test in `v2/src/commands/tui.test.ts` proving one running TUI shows runs from a newly discovered live daemon fails against the pre-fix code (fixed startup connection set) and passes after the change.
- [ ] Inverting each added guard (drop-only-when-not-live, retry-on-connect-failure, owner-dropped selection clear, rediscovery-failure passthrough) makes at least one test fail; the drop and selection-clear negative cases prove the exited daemon's exclusive runs and the stale selection are absent.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — § TUI: per-tick rediscovery, connection add/drop, and selection behavior when the owning daemon exits.
- `v2/docs/operator-runbook.md` — the TUI is the cross-daemon observation surface; it follows dispatch moving to a new digest without restart, while `daemon status`/`run list` stay per-digest.
- `v2/docs/v1-behaviors.md` — record that a running TUI follows daemon supersession.
