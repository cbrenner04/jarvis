---
name: daemon-status-reports-every-live-daemon
---

# `jarvis daemon status` reports every live daemon

## Problem

`jarvis daemon status` answers for the invoking keyed socket only. On 2026-07-24 seventeen live
daemons held `~/.jarvis/state/v2.sqlite` open and `status` truthfully said `running` — the pile was
only findable with `lsof`/`ps`. Daemon count is invisible to the harness, which produced two wrong
lock-contention diagnoses before the real cause was found.

## Decisions

- Extend `jarvis daemon status` rather than add a subcommand — `status` is where an operator already
  looks, and the north star is fewer commands. Rules out a `daemon list`/`daemon ps` subcommand.
- Enumerate `~/.jarvis/daemon-*.sock` and probe each, reusing the existing peer-socket enumeration
  the supersede pass uses. Rules out shelling out to `lsof`/`ps` for the inventory.
- Per daemon report: PID, socket path, loaded revision/digest, retiring flag, active-run count.
  These are the fields the reaping and retirement questions are actually asked with.
- Sockets that fail their probe are reported as unreachable, not omitted — an unreachable entry is
  operator-visible evidence, not noise.
- Out of scope: reaping or killing anything. This intent only makes the pile visible.

## Acceptance criteria

- [ ] `jarvis daemon status` lists every live keyed daemon with PID, socket, loaded digest, retiring
      state, and active-run count.
- [ ] With one daemon up, `status` still names that daemon — the single-daemon case does not regress.
- [ ] A test with several live keyed daemons asserts all are listed; hiding any one fails it.
- [ ] A socket whose probe fails is reported as unreachable rather than dropped.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — the `status` reply shape covering all live daemons.

## Prerequisites
