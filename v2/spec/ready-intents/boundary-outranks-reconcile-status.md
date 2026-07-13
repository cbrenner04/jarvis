---
name: boundary-outranks-reconcile-status
---

# A run row's status never contradicts its own terminal event

When a reconcile (`run_reconciled / killed / daemon_restart`) and a real boundary
(`boundary_committed`) both land for one run, `jarvis run list` reported `killed` for a run
whose log carries a `blocked` boundary — the row contradicted its own terminal event.

The agent's real outcome outranks the harness's guess: a boundary commit takes precedence over
a reconcile kill regardless of arrival order, so the row's status agrees with the run's
terminal event in the durable log.

## Documentation updates

- `v2/docs/daemon-host.md` — reconcile vs. boundary precedence.
- `v2/docs/state-store.md` — run status must agree with the run's terminal event.

## Prerequisites
