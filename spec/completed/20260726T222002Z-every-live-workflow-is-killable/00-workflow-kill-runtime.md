# 00 - Live workflow kill runtime

## Problem

`killHandler` accepts only `activeRun.kind === "write-loop"`. Workflow `ActiveRun` rows carry no
`AbortController`, so a workflow step id that `list` can show `isLive` still gets `run_not_active`
from `jarvis run kill`.

## Decisions

- One `AbortController` per workflow `start` invocation, shared by the claim row and every
  `onStepRunCreated` row; rules out per-step controllers (kill one step would not stop the graph)
  and run-row/process-derived handles. The claim row holds the controller for invocation lifetime;
  it is not an operator `kill` target id (after `start` returns, the operator-facing id is step 0).
- Daemon injects that `signal` onto each step object passed to `executeWorkflow` before dispatch
  (IPC steps stay JSON-only), on the write-step path `prepareWorkflowStep` / `runWorkflowStep`
  already consume; rules out expecting callers to supply abort via `start` params.
- **Operator-visible `kill` rule:** `jarvis run kill <runId>` succeeds when `activeRuns` holds a
  workflow row whose `runId` equals the named id (same lookup shape as write-loop:
  `activeRuns.get(ownershipKey) ?? activeRuns.get(runId)`, kind `workflow`). Authorization is that
  row only — no stall, idle-age, progress, or subprocess-inference gates. `list` `isLive` is
  `in-progress` ∧ id ∈ live set from `activeRuns`; when `isLive` is true for a step id, kill must
  succeed. Kill may still succeed briefly while the row remains in `activeRuns` after durable
  status left `in-progress` during unwind; tests exercise the held-live fixture where both align.
- `kill` on an authorized workflow row aborts the shared controller and calls `commitGuardedKill` on
  the named `runId`; `commitGuardedKill` on an already-terminal durable row is expected to no-op
  while abort still stops the graph; rules out worktree teardown on kill.
- **Settlement:** the named step row becomes durable `killed`; already-terminal sibling step rows
  stay unchanged; the workflow entry row's `list` reported status rolls up to `killed` after kill
  settles (not workflow `failed` from abort unwind alone).
- **Kill scope:** abort must stop the in-flight agent-bearing step (signal reaches role invocation);
  halting remaining `executeWorkflow` publication/landing work that does not honor step `signal` is
  out of scope — follow-up if operators need stronger tail cancellation.
- `pause` on workflow rows stays `run_not_active`; rules out shipping pause without a boundary
  contract.
- Non-live workflow rows (no matching `activeRuns` workflow row) still reject `kill` with
  `run_not_active`; rules out kill as a durable-status mutator for absent live entries.
- **Non-goals:** kill by internal claim id before step 0 exists; new ACs for double-kill idempotency
  or kill-during-daemon-retire (mirror write-loop informally if needed).

## Prerequisites

- The daemon tracks live workflow invocations in `activeRuns` and deletes those entries when the
  workflow settles (`onStepRunCreated` / `.finally`).
- `executeWorkflow` steps accept an optional `signal` that reaches role invocation
  (`v2/src/execution/workflow-runner.ts`); daemon-side injection is on the objects passed into
  `executeWorkflow` from `startWorkflowRun`, not a caller-supplied IPC field.

## Tasks

- Extend workflow `ActiveRun` with `abortController`; wire claim + `onStepRunCreated` entries (one
  shared instance).
- Inject the invocation `signal` onto each step in `startWorkflowRun` before `executeWorkflow`.
- Add a `killHandler` branch for live workflow rows (abort shared controller + `commitGuardedKill`
  on named `runId`).
- Flip `daemon-workflow-start.test.ts` live-kill expectations (see acceptance criteria); add
  settlement, rollup, signal, authorization-guard, and structural controller tests as needed.

## Acceptance criteria

- [x] A test in `v2/src/daemon/daemon-workflow-start.test.ts` (replacing
      `kill rejects a workflow-started run's step-0 runId with run_not_active`) holds step 0 live
      via a never-resolving binding, calls `kill` on that `runId`, and asserts `{ ok: true }`; it
      fails against the pre-fix code (`run_not_active`).
- [x] A test in `v2/src/daemon/daemon-workflow-start.test.ts` (replacing the kill half of
      `kill/pause reject a later step's runId once onStepRunCreated has tracked it`) holds a later
      tracked step live, asserts `{ ok: true }` from `kill`, and leaves the pause half expecting
      `run_not_active`.
- [x] A test asserts the claim row and every `onStepRunCreated` workflow row share the same
      `AbortController` instance (not merely that kill aborts in tests).
- [x] A test asserts the `signal` on steps passed to `executeWorkflow` is aborted by `kill` and the
      in-flight step unwinds (binding observes abort); omitting daemon-side signal injection fails
      the test.
- [x] After kill settles, `list` reports the targeted step `isLive: false` with durable status
      `killed`, the workflow entry row reported status is `killed`, and the project worktree path
      for the run's branch still exists on disk; a completed sibling step row's durable status is
      unchanged when kill targets a later in-flight step.
- [x] After a workflow finishes and `activeRuns` clears, `kill` on a prior step `runId` still
      returns `run_not_active`.
- [x] `v2/src/daemon/daemon-workflow-start.test.ts` includes a guard-inversion test that inverting
      the workflow `activeRuns` liveness check in `killHandler` (`v2/src/daemon/daemon.ts`) restores
      `run_not_active` for a held-live workflow step; no stall, idle-age, or progress predicate
      appears in that authorization path.
- [x] `v2/src/daemon/daemon-start-list.test.ts` kill tests stay green (write-loop kill behavior unchanged).
- [x] `v2/src/daemon/daemon-workflow-start.test.ts` `pause rejects a workflow-started run's step-0 runId with
      run_not_active` and the pause half of `kill/pause reject a later step's runId once
      onStepRunCreated has tracked it` stay green.

## Documentation updates

Deferred to [01 - Operator docs for workflow kill](./01-workflow-kill-operator-docs.md).
