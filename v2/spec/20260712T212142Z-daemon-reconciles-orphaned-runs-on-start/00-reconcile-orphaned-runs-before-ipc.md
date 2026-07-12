# Reconcile orphaned runs before IPC

A restarted daemon currently exposes durable non-terminal rows left by the prior
process even though no live executor owns them. Reconcile those rows to a truthful
terminal state before clients can connect.

## Decisions

- Reconcile `queued`, `in-progress`, `paused`, `budget-soft-stopped`,
  `awaiting-human`, and `revising`; leave `completed`, `blocked`, `failed`, and
  `killed` unchanged.
- Set each orphan to existing terminal status `killed`; do not add a run status.
- Append one `run_reconciled` structured-log event per transitioned run with
  `runStatus: "killed"` and `reason: "daemon_restart"`. This dedicated event
  avoids fabricating an attempt boundary or execution failure.
- Finish state and log reconciliation before opening the IPC listener. A startup
  reconciliation error fails daemon startup instead of exposing partially
  reconciled state.
- Reconciliation changes only durable status and logs. Worktree paths, branches,
  attempts, checkpoints, queued input, and workflow snapshots remain intact.
- Keep on-demand kill and cleanup behavior unchanged; current-daemon wedged-run
  handling and worktree reclamation remain out of scope.

## Tasks

- Add startup reconciliation over durable runs and the terminal structured-log
  event contract.
- Invoke reconciliation after opening durable state/log storage and before
  starting the IPC server.
- Cover all non-terminal and terminal statuses, event emission, retained run
  metadata, startup ordering, and reconciliation failure behavior.
- Render the reconciliation event and `daemon_restart` reason through
  `jarvis run log <run-id>`.
- Update the durable behavior docs.

## Documentation updates

- `v2/docs/daemon-host.md` — document reconciliation ordering, covered statuses,
  killed status/reason, startup failure behavior, and retained worktrees/branches.
- `v2/docs/v1-behaviors.md` — record v2 daemon-restart orphan reconciliation.

## Acceptance criteria

- [x] Before accepting IPC, daemon startup changes every durable `queued`, `in-progress`, `paused`, `budget-soft-stopped`, `awaiting-human`, and `revising` run to `killed`.
- [x] Startup leaves durable `completed`, `blocked`, `failed`, and `killed` runs unchanged.
- [x] Each transitioned run receives exactly one terminal `run_reconciled` log event with `runStatus: "killed"` and `reason: "daemon_restart"`; unchanged terminal runs receive no reconciliation event.
- [x] `jarvis run log <run-id>` renders the `run_reconciled` event including `daemon_restart`.
- [x] Reconciliation completes before the IPC listener opens, and a state or log reconciliation error prevents the daemon from serving IPC.
- [x] Reconciliation preserves each run's worktree, branch, attempt/checkpoint, queued input, and workflow snapshot data.
- [x] `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md` describe the shipped restart behavior and retained worktrees/branches.
