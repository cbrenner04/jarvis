# Daemon must reconcile orphaned runs at startup

Six runs sat at `in-progress` / `not-live` indefinitely, across many daemon
restarts, with no way to clear them. They then sorted to the *top* of the TUI,
because active-first ordering promotes exactly the status they were stuck in.

## Problem

v2 hosts every run **in-process** in the daemon (`spawnWriteLoop`, fire-and-forget
in `daemon.ts`). So a daemon restart kills every run it owned — unconditionally.

That makes the invariant simple: **after a daemon starts, no run from a previous
daemon can still be running.** Any durable row still in a non-terminal status
(`in-progress`, `revising`, `awaiting-human`, `queued`, …) at startup is orphaned
by construction.

Nothing enforces that today:

- The status row stays `in-progress` forever.
- `list` correctly reports `isLive: false` — the daemon *already knows* the run is
  dead. It just never writes it down.
- `run kill` returns `run_not_active`, because the in-memory registry it consults
  is empty after a restart. So the operator cannot clear them at all.
- `daemon-terminal-run-retention` will not help: it bounds *terminal* runs, and
  these are non-terminal, hence exempt.

Observed 2026-07-12: six `plan/*` runs orphaned by the plan-workflow spawn stall
survived every restart and had to be cleared by hand-editing the state store.

## Scope

- On daemon start, before serving IPC: transition every non-terminal durable run
  to a terminal status with a named reason (e.g. `killed` / `orphaned`,
  `failureReason: daemon_restart`). Record it as a terminal event in the run's
  structured log so `run log` explains the transition.
- The `isLive: false` the liveness prober already computes is the signal — startup
  reconciliation is writing down what `list` has been reporting all along.
- Worktrees are retained, not removed; reclaiming those is `v2-cleanup-command`.

## Decisions

- **Reconcile at startup, not on demand.** A kill command that works on wedged runs
  (`workflow-wedged-run-killable`) is a strictly weaker fix: it requires the
  operator to notice, and it cannot run when the daemon that owned the run is gone.
  Reconciliation makes the incoherent state unrepresentable instead of recoverable.
  That intent should be reconciled against this one — possibly subsumed by it.
- No run may be `in-progress` while `isLive` is false. If those two can disagree,
  one of them is lying; the status is the one that must yield.
- Applies to `queued` too: an un-promoted queued run cannot survive a restart.

## Out of scope

- Resuming orphaned runs (they are killed, not restarted).
- Worktree/branch reclamation — `v2-cleanup-command`.

## Documentation updates

- `v2/docs/daemon-host.md` — the startup reconciliation invariant and the terminal
  reason it writes.
