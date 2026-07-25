---
name: daemon-inventory-and-retirement
---

# Daemons are inventoried, log what blocks their exit, and are retired by cleanup

## Problem

On 2026-07-24 seventeen live daemons held `~/.jarvis/state/v2.sqlite` open. Nothing in the harness
could see or clear them:

- `jarvis daemon status` answers for the invoking keyed socket only, so it truthfully said `running`
  while the pile was findable only with `lsof`/`ps`. Daemon count being invisible produced two wrong
  lock-contention diagnoses before the real cause was found; `ps`/`lsof` were needed twice again on
  2026-07-25.
- `jarvis cleanup` enumerates `~/.jarvis/daemon-*.sock` but removes a socket only on an
  `ECONNREFUSED`/`ENOENT` connect probe. All sixteen stale sockets had live listeners, so cleanup
  preserved every one by design and reported them healthy. `pkill` is the only reaping path today.
- At least two of the seventeen started *after* both `starting-daemon-supersedes-older-daemons` and
  `retire-superseded-daemon-when-idle` shipped, and still coexisted for over a day. Why they failed to
  exit is not established — candidates are that supersede was never delivered (peer discovery found no
  peers) and that `activeRuns` retained a stuck entry so `hasActiveRuns()` never went false.

## Decisions

- Extend `jarvis daemon status` rather than add a subcommand — `status` is where an operator already
  looks, and the north star is fewer commands. Rules out a `daemon list`/`daemon ps` subcommand.
- Enumerate `~/.jarvis/daemon-*.sock` and probe each, reusing the peer-socket enumeration the
  supersede pass uses. Rules out shelling out to `lsof`/`ps` for the inventory.
- Per daemon report: PID, socket path, loaded revision/digest, retiring flag, active-run count —
  the fields the reaping and retirement questions are actually asked with.
- Sockets that fail their probe are reported as unreachable, not omitted; an unreachable entry is
  operator-visible evidence, not noise.
- **Instrument the retirement check only; do not change `shouldShutdownNow`.** Four prior attempts at
  the adjacent `reapable` discriminant failed by editing the condition against a guess
  (`wedged-workflow-kill-needs-a-live-stall-signal`). Rules out a speculative condition fix.
- A daemon that is retiring but not exiting records the active-run count and the **blocking run IDs**
  in its process log — IDs, not just a count, since a count cannot distinguish a real run from a
  wedged entry. Rate-limit or dedupe so a 100 ms check interval does not flood the log.
- Cleanup retires a live daemon only when it reports retiring/superseded **and** zero active runs —
  the same evidence the daemon uses to retire itself. Rules out a blanket kill of every peer socket.
- Cleanup names every daemon it left alone and why (not superseded / has active runs). Rules out the
  silent preservation that made the pile invisible.
- Retire via the daemon's own shutdown path, not a signal, so in-flight state is respected. Rules out
  `SIGKILL` by PID. The invoking/current daemon is never retired by cleanup.

## Acceptance criteria

- [ ] `jarvis daemon status` lists every live keyed daemon with PID, socket, loaded digest, retiring
      state, and active-run count; a test with several live daemons fails if any one is hidden.
- [ ] With one daemon up, `status` still names that daemon — the single-daemon case does not regress.
- [ ] A socket whose probe fails is reported as unreachable rather than dropped.
- [ ] A daemon that is retiring and has not exited records, in its process log, the active-run count
      and the run IDs blocking its exit, without repeating once per check interval.
- [ ] A superseded daemon with no active runs still exits on its own without operator action (pin the
      existing contract so this work cannot regress it).
- [ ] `jarvis cleanup` retires a live superseded daemon reporting no active runs; its socket is gone
      afterward.
- [ ] `jarvis cleanup` leaves a live non-superseded daemon, and a superseded daemon with an active
      run, untouched — naming each with its reason. Inverting either guard fails a test.
- [ ] Dead-socket reaping still works unchanged.

## Documentation updates

- `v2/docs/daemon-host.md` — the `status` reply shape covering all live daemons; the
  retirement-blocked log record and how to read it; cleanup's live-daemon retirement gate.
- `v2/docs/operator-runbook.md` — § Overlapping daemons promises "once settled, the daemon disappears
  on its own… no manual stop command is needed"; seventeen daemons over three days contradict that.
  Replace it with how to inventory daemons and how cleanup retires them.

## Prerequisites

Plan as three subspecs in order: inventory (`status`), retirement instrumentation, cleanup
retirement. Cleanup depends on the inventory's peer-socket query path — reuse it rather than adding a
second one.
