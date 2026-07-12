---
name: daemon-reconciles-orphaned-runs-on-start
---

# Daemon reconciles orphaned runs before serving IPC

At startup, the daemon transitions every durable non-terminal run left by a previous daemon to `killed` before accepting IPC. This includes `queued`, `in-progress`, `paused`, `budget-soft-stopped`, `awaiting-human`, and `revising`; terminal rows remain unchanged. Each transition appends a terminal structured-log event carrying reason `daemon_restart`, and `jarvis run log <run-id>` renders that reason. Worktrees and branches remain intact.

## Decisions

- Reconcile before opening the IPC socket, not through an operator command — rules out exposing stale non-terminal rows during startup.
- Mark orphans `killed` with reason `daemon_restart`, not `failed` or a new run status — preserves the existing terminal-status wire vocabulary while distinguishing restart termination in logs.
- Reconcile every durable non-terminal status, including `queued`, `paused`, and `awaiting-human`, not only `in-progress` — no prior-daemon execution or admission state survives process loss.
- Retain worktrees and branches, not reclaim them during reconciliation — cleanup remains owned by `v2-cleanup-command`.

## Out of scope

- Automatically resuming orphaned runs.
- Worktree or branch reclamation.
- On-demand killing of wedged runs owned by the current daemon.

## Documentation updates

- `v2/docs/daemon-host.md` — startup reconciliation ordering, covered statuses, terminal status and reason, and retained worktrees.
- `v2/docs/v1-behaviors.md` — v2 startup orphan reconciliation behavior.

## Prerequisites

- Run status and structured logs are durably readable before the daemon opens its IPC socket.
