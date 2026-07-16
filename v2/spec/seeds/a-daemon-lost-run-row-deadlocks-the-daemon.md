---
name: a-daemon-lost-run-row-deadlocks-the-daemon
---

# A durable run row the daemon has lost is unkillable, and it permanently blocks `daemon stop`

`jarvis daemon stop` refuses while any durable run row is non-terminal. `jarvis run kill <id>`
refuses any run the daemon does not hold in memory. A row that is non-terminal *and* not in memory
therefore satisfies both refusals at once and can never be cleared by any command. Because the
harness **requires** a daemon restart after merging any v2 change (stale code snapshot), one such
row wedges the daemon — and with it every subsequent v2 code merge — indefinitely.

## Problem

Observed 2026-07-16, on `main` at `0289a223`:

```sh
$ jarvis daemon stop
DaemonStopRefusedError: active durable runs: df8ec8f8-67aa-4a26-8d39-01d57d421299

$ jarvis run kill df8ec8f8-67aa-4a26-8d39-01d57d421299
run_not_active: Run df8ec8f8-67aa-4a26-8d39-01d57d421299 is not currently active
```

`run list` reports the row as `in-progress` / `not-live`. Its spec
(`20260716T193202Z-completed-published-run-records-pr-evidence`) had already shipped: PR merged,
spec archived to `completed/` by a prior `jarvis1 cleanup`. The work was *done*; only the row was
stranded, left behind by a previous operator session.

The two guards are individually reasonable and jointly a deadlock:

- `daemon-stop-refuses-active-runs` (#1607) makes `stop` refuse non-terminal rows — right, so a
  restart cannot silently kill live work.
- `run kill` refuses runs with no in-memory handle — right, since there is no process to signal.

Neither owns the case where the row is non-terminal but the process is long gone. `run list`
already knows: it prints `not-live` next to `in-progress`. Nothing acts on that knowledge.

This is the durable-state twin of `v2-reclaims-its-workspace`'s decision that "a wedged run's
worktree must be reclaimable without the daemon's cooperation" — same root cause (the daemon lost
the run), different casualty (the row, not the worktree). That seed reclaims disk; this one
reclaims the ability to restart.

## Decisions

- **A non-terminal row with no live process is reconcilable on demand, not only at daemon start.**
  Startup already reconciles orphans to `killed` with reason `daemon_restart` — but reaching
  startup requires a stop, which the orphan itself forbids. The reconciliation must be available
  without a restart. Rules out today's "restart to clear the rows that prevent the restart".
- Liveness, not row status, decides whether `stop` may proceed. A row the daemon cannot produce a
  live process for does not protect anything. Rules out `stop` blocking on a row it knows is
  `not-live`.
- `run kill` on a non-live non-terminal row settles the durable row rather than refusing. The
  operator's intent ("end this run") is satisfiable even when there is no process to signal; the
  current refusal is an implementation detail leaking as a contract. Rules out requiring a separate
  reconcile subcommand — per the north star, fold it into the existing command.
- No hand-editing of `~/.jarvis/state/v2.sqlite` is an acceptable recovery. If the only escape from
  a wedged daemon is SQL, the harness has no answer.

**Recovery that works, verified 2026-07-16:** `kill -9 <daemon-pid>` then `jarvis daemon start`.
Startup reconciliation settles every orphaned row to `killed` / `daemon_restart` before IPC opens,
and `daemon stop` then succeeds normally. This *confirms the decision above rather than resolving
it*: the reconciliation logic is already correct and already knows what to do — the only thing
standing between the operator and it is the `stop` refusal, which `kill -9` bypasses. Requiring
`kill -9` to reach a working code path is the bug, not the fix.

Second live instance the same session: a workflow-started implement (`a51cfe79`) whose agent
process tree had been killed still reported `in-progress` / **`live`**, and `run kill` still refused
it `run_not_active`. So the wedge is reachable from two directions — a stale `not-live` row and a
falsely-`live` one — and `run kill` refuses both. Two stranded rows then refused `daemon stop`
together.

## Prerequisites

- None.

## Out of scope

- Reclaiming the worktree/branch of a wedged run (`v2-reclaims-its-workspace`).
- Reaping a genuinely *live* wedged run (`workflow-wedged-run-killable`).
- Whether a restart should be required after a v2 merge at all
  (`daemon-runs-stale-code-until-restarted`).

## Documentation updates

- `v2/docs/operator-runbook.md` § Recovery — how to clear a stranded non-terminal row; drop any
  guidance implying a restart is the only path.
