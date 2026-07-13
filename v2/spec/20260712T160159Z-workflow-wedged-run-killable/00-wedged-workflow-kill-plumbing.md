# Wedged workflow kill plumbing

A workflow-started run that `jarvis run list` reports as non-terminal and `live`
must accept `jarvis run kill` and reach durable status `killed` with the
worktree retained (dirty). Today `activeRuns` tracks workflow steps with
`kind: "workflow"` but `killHandler` only acts on `kind: "write-loop"`, so
`list` liveness and kill disagree — operators see `in-progress`/`live` yet get
`run_not_active`.

Depends on the prerequisites in [intent.md](./intent.md). Out of scope:
pause/resume for workflow-started runs; redesigning workflow step execution.

## Decisions

- Kill by the same `runId` `list` shows for the wedged step — rules out a
  separate reap id or ad-hoc-only kill.
- Preserve healthy-run steering deferral: an actively progressing workflow step
  keeps today's `run_not_active` kill rejection; only wedged steps become
  killable.
- **Wedged-vs-healthy discriminant (pinned here):** extend workflow-kind
  `activeRuns` entries with `reapable: boolean` (default `false`). The workflow
  runner sets `reapable: true` on the active step's runId via a new
  `onStepReapable(stepIndex, runId)` callback when that step's write loop has
  emitted `iteration_started` and is stalled with no bound agent subprocess for
  the active attempt (the plan-workflow wedge shape). Steps with a live agent
  binding or post-`iteration_started` forward progress keep `reapable: false`.
  Orphaned liveness — workflow background task settled but an `activeRuns`
  entry remains — also sets `reapable: true` on the stale runId before kill is
  offered.
- **`killHandler` for reapable workflow entries:** when `activeRun.kind ===
  "workflow"`, `activeRun.runId === runId`, and `activeRun.reapable === true`:
  abort any step-local control wired for that run, `setRunStatus(runId,
  "killed")`, remove all `activeRuns` entries for that workflow invocation's
  tracked runIds, release the workflow ownership key in `_registry` if still
  held, return `{ ok: true }`. Worktree stays on disk dirty (same contract as
  bare `kill`).
- **`pauseHandler` unchanged:** workflow entries remain `run_not_active` for
  pause regardless of `reapable`.
- **List/kill coherence:** after a successful workflow kill, a subsequent
  `list` row for that `runId` shows `status: "killed"` and `isLive: false`. A
  run `list` still marks `live` must not return `run_not_active` from `kill`
  when its `activeRuns` entry is `reapable`.

## Task checklist

- Add `reapable` to workflow-kind `ActiveRun` and thread `onStepReapable` from
  `executeWorkflow` through the daemon workflow start path.
- Mark `reapable: true` from the workflow runner on the stall/orphan shapes
  above; keep healthy in-flight steps at `reapable: false`.
- Extend `killHandler` for reapable workflow entries; leave non-reapable
  workflow and all `pause` paths as today.
- Add daemon tests: reapable workflow kill succeeds, durable `killed`, `list`
  `isLive: false`; healthy workflow kill still `run_not_active`; bare
  write-loop kill unchanged.

## Acceptance criteria

- [ ] A workflow-started run whose `list` row is `in-progress` and `live` and
      whose `activeRuns` entry is `reapable: true` accepts `jarvis run kill`
      (daemon `kill` RPC) and returns success.
- [ ] After that kill, the same `runId` has durable status `killed`, the
      external worktree still exists, and `list` reports `isLive: false`.
- [ ] A workflow-started run that is actively progressing (`reapable: false`)
      still rejects `kill` with `run_not_active`.
- [ ] `pause` on a workflow-started run (reapable or not) still rejects
      `run_not_active`.
- [ ] `daemon-workflow-start.test.ts` bare write-loop kill/pause tests and
      non-reapable workflow kill/pause reject tests stay green for the healthy
      paths they cover today.

## Documentation updates

- None in this subspec — operator-facing docs land in
  [01 - Wedged workflow kill docs](./01-wedged-workflow-kill-docs.md).
