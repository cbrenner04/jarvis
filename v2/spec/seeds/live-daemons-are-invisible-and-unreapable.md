# Live daemons are invisible to jarvis and cannot be reaped

## Problem

On 2026-07-24 the operator machine had **seventeen** live daemon processes, every one holding
`~/.jarvis/state/v2.sqlite` open, alongside sixteen keyed sockets dating back to 2026-07-21:

```console
$ lsof ~/.jarvis/state/v2.sqlite | tail -n +2 | wc -l
17
$ ps ax -o args= | grep -c '[d]aemon-entrypoint.ts'
17
$ ls ~/.jarvis/daemon-*.sock | wc -l
16
```

No jarvis command reports this. `jarvis daemon status` answers for the current keyed socket only and
said `running` — truthfully, and uselessly. The pile was found with `lsof` and `ps`, not with the
harness. `jarvis cleanup` enumerates `~/.jarvis/daemon-*.sock` but removes a socket only when its
connect probe gets `ECONNREFUSED`/`ENOENT`; every one of these had a live listener, so cleanup
preserved all sixteen by design and reported them as healthy.

The cost is not cosmetic. Combined with the store's `journal_mode=delete` / `busy_timeout=0`
(`concurrent-workflows-lose-work-to-a-locked-state-store`), seventeen processes on one database made
every workflow lose a lock race: four consecutive workflows died `run_execution_failed:
"database is locked"` after clean, completed write steps. Killing the pile by hand and starting one
daemon made the very next workflow succeed on the first attempt. Two wrong diagnoses were published
before the real cause was found — first "concurrent workflows contend", then "the operator's own
`run list` polling contends" — because nothing in the harness surfaces daemon count.

**What is not established:** why they failed to exit. The retirement path reads correct —
`shouldShutdownNow(shutdownRequested, isRetiring, hasActiveRuns)` on a 100 ms interval
(`v2/src/daemon/daemon.ts:1546`), so a superseded daemon with no active runs should exit promptly.
Most of these predate `starting-daemon-supersedes-older-daemons` and
`retire-superseded-daemon-when-idle` (both 2026-07-22) and simply cannot retire, which is
self-limiting. But at least two started *after* both shipped and still coexisted for over a day. Do
not assume a live leak and do not assume its absence — the two candidate causes are that supersede
was never delivered (peer discovery found no peers) and that `activeRuns` retained a stuck entry so
`hasActiveRuns()` never went false, which is the same wedged-entry state
`a-daemon-lost-run-row-deadlocks-the-daemon` describes.

## Decisions

- Give the operator a daemon inventory: every live keyed daemon with its PID, socket, loaded
  revision/digest, retiring flag, and active-run count. Extend `jarvis daemon status` rather than
  adding a subcommand — the north star is fewer commands, and `status` is already where an operator
  looks. Rules out requiring `lsof`/`ps` to answer "how many daemons are running".
- `jarvis cleanup` must be able to retire a **live** superseded daemon with no active runs, not only
  reap dead sockets. Gate it on the same evidence the daemon uses to retire itself, and report each
  daemon it left alone with the reason. Rules out a blanket kill, and rules out leaving `pkill` as
  the only answer.
- Determine empirically why the two post-fix daemons did not exit before changing the retirement
  condition. Instrument the retirement check so a daemon that is retiring but not exiting says why
  (active-run count, and which runs) in its process log. Rules out editing `shouldShutdownNow`
  against a guess — four prior attempts at the adjacent `reapable` discriminant failed exactly that
  way (`wedged-workflow-kill-needs-a-live-stall-signal`).
- Out of scope: the store's locking behavior. WAL plus a busy timeout is
  `state-store-wal-concurrent-writes`, and it removes the *consequence*; this seed removes the
  *accumulation* and the blindness. Both are wanted — WAL alone leaves an unbounded process pile that
  no jarvis command can see.

## Acceptance criteria

- [ ] `jarvis daemon status` reports every live keyed daemon — PID, socket, loaded digest, retiring
      state, active-run count — not only the invoking one; with one daemon up its output still names
      that daemon, so the single-daemon case does not regress.
- [ ] A test with several live keyed daemons asserts `status` lists all of them; hiding any one fails
      it.
- [ ] `jarvis cleanup` retires a live superseded daemon that reports no active runs, and its socket
      is gone afterward.
- [ ] `jarvis cleanup` leaves a live **non**-superseded daemon and a superseded daemon **with** an
      active run untouched, naming each and why. Inverting either guard fails a test.
- [ ] A daemon that is retiring but has not exited records, in its process log, the active-run count
      and run IDs blocking its exit.
- [ ] A superseded daemon with no active runs still exits on its own without operator action — the
      existing contract, pinned so this work cannot regress it.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — the `status` reply shape covering all live daemons, and cleanup's
  live-daemon retirement gate.
- `v2/docs/operator-runbook.md` — § Overlapping daemons currently promises "once settled, the daemon
  disappears on its own… no manual stop command is needed." Seventeen daemons over three days
  contradict that as an operational guarantee; replace it with how to inventory daemons and how
  cleanup retires them.

## Prerequisites

None. Independent of `state-store-wal-concurrent-writes`, and wanted even after it ships.
