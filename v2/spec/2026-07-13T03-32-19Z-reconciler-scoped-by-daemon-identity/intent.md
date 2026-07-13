---
name: reconciler-scoped-by-daemon-identity
---

# Orphan reconciler only sweeps runs from a prior daemon incarnation

The startup reconciler (`reconcileOrphanedRuns`) selects rows by "non-terminal right now"
(`state-store.beginRunReconciliation`), so it can kill runs the *current* daemon admitted.
Observed 2026-07-13: a daemon started at 01:56, admitted two runs at 01:57, and marked both
`killed / daemon_restart` at 02:00 while their agents were still working.

Scope the sweep by daemon identity, not liveness-at-scan-time:

- Persist the admitting daemon's identity (pid + boot/start epoch, enough to distinguish
  incarnations across pid reuse) on the run row at admission.
- The reconciler considers only rows whose recorded identity is not the current process's.
- Rows admitted by this process are never candidates, whenever the sweep runs.

Fix the scoping, not the timing: a sweep that merely runs earlier still races a run admitted
a millisecond later.

Out of scope: whether the observed runs' `blocked` outcome was correct.

## Documentation updates

- `v2/docs/daemon-host.md` — reconciler scope; guarantee it cannot touch runs the current
  process admitted.
- `v2/docs/state-store.md` — the daemon-identity field on the run row.
- `v2/docs/v1-behaviors.md` if v1 behavior changes.

## Prerequisites
