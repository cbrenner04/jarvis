---
name: cleanup-retires-live-superseded-idle-daemons
---

# `jarvis cleanup` retires live superseded idle daemons

## Problem

`jarvis cleanup` enumerates `~/.jarvis/daemon-*.sock` but removes a socket only when its connect
probe returns `ECONNREFUSED`/`ENOENT`. All sixteen stale sockets on 2026-07-24 had live listeners, so
cleanup preserved every one by design and reported them healthy. `pkill` is currently the only way to
reap them.

## Decisions

- Cleanup retires a live daemon only when it reports retiring/superseded **and** zero active runs —
  the same evidence the daemon uses to retire itself. Rules out a blanket kill of every peer socket.
- Cleanup names every daemon it left alone and why (not superseded / has active runs). Rules out
  silent preservation, which is what made the pile invisible.
- Retire via the daemon's own shutdown path, not a signal, so in-flight state is respected. Rules out
  `SIGKILL` by PID.
- The invoking/current daemon is never retired by cleanup.
- This intent shares the peer-socket enumeration/query seam with
  `daemon-status-reports-every-live-daemon`. Plan and land it **after** that intent, against its
  merged result, and reuse the same query path rather than adding a second one. Rules out parallel
  fan-out off a shared base.

## Acceptance criteria

- [ ] `jarvis cleanup` retires a live superseded daemon reporting no active runs; its socket is gone
      afterward.
- [ ] `jarvis cleanup` leaves a live non-superseded daemon untouched and names it with the reason.
- [ ] `jarvis cleanup` leaves a superseded daemon with an active run untouched and names it with the
      reason.
- [ ] Inverting either guard fails a test.
- [ ] Dead-socket reaping still works unchanged.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — cleanup's live-daemon retirement gate.
- `v2/docs/operator-runbook.md` — § Overlapping daemons promises "once settled, the daemon disappears
  on its own… no manual stop command is needed"; seventeen daemons over three days contradict that.
  Replace it with how to inventory daemons and how cleanup retires them.

## Prerequisites

- A live daemon can be queried over its keyed socket for its retiring flag and active-run count —
  satisfied by `daemon-status-reports-every-live-daemon`, which must land first unless that query
  path already exists independent of the `daemon status` CLI surface.
