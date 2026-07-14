---
name: daemon-restart-auto-resumes-orphaned-runs
---

# Daemon restart auto-resumes orphaned runs

Startup currently reconciles orphaned non-terminal runs to `killed` / `daemon_restart` and leaves recovery for the operator, losing the interrupted iteration and hiding the affected run set.

## Prerequisites

- Killed workflow-backed runs resume from their persisted workflow snapshot with usable bindings and step inputs.

## Behavior

- After IPC opens, automatically resume every run startup reconciled from an orphaned non-terminal row, including runs orphaned by a forced stop.
- Make each automatic resume or admission failure observable in the run log and durable run state.

## Decisions

- Recover from durable reconciliation results on every startup, not from a pre-stop in-memory list; rules out covering orderly forced stops while missing crashes.
- Open IPC before automatic recovery begins; rules out making daemon readiness wait for minute-long resumed work.
- Keep the existing run identity and worktree; rules out replacement runs that fragment history or abandon dirty work.

## Out of scope

- Refusing an unforced stop while runs are active.
- Hot-reloading daemon code.
- Multi-operator coordination.

## Documentation updates

- Replace `v2/docs/operator-runbook.md` recovery guidance for restart orphans with automatic recovery and failure semantics.
- Update `v2/docs/daemon-host.md` with restart ordering, recovery, and observability contracts.
