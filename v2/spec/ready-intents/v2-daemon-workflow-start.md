---
name: v2-daemon-workflow-start
---

# Daemon `start` accepts a workflow, not just a bare write loop

Extend the daemon's `start` RPC so a caller can launch an ordered multi-step workflow
(`executeWorkflow` over `steps[]`), not only a single bare `WriteLoopInput`. Existing
bare-`WriteLoopInput` callers keep working unchanged.

A prior single-subspec plan of this intent proved too large to land — every actuator
(claude, cursor, opencode, GLM 5.2, opus) exited `no-progress` because no single iteration
could reach a compiling, passing state. Split it into small, independently-landable subspecs
so each one is completable in one iteration.

## Decisions

- `start` accepts either the existing bare `WriteLoopInput` shape or a workflow-shaped input
  carrying an ordered `steps[]`; the daemon dispatches to `executeWriteLoop` or
  `executeWorkflow` accordingly. A distinct `steps` key (not an overload of `input`'s shape);
  both present or neither is rejected `invalid_params`.
- Runs/state-store/list-row behavior for a workflow-started run matches what `executeWorkflow`
  already persists per step — no new resume/pause/abort semantics invented here.
- Lands on the in-process daemon test harness; no new socket-gated tests, no new client-side
  field validators.
- Workflow starts skip the memory-headroom queuing path (insufficient headroom rejects rather
  than queues); real kill/pause plumbing for a running workflow is deferred to a first consumer.

## Suggested subspec split

Author as separate atomic subspecs, each independently testable and loop-completable:

1. **Dispatch core** — `start`'s params become `{ input } | { steps }`; `steps` routes to
   `executeWorkflow`, `input` to the unchanged write-loop path; both/neither → `invalid_params`.
   Add `onFirstRunCreated?: (runId) => void` to `WorkflowRunnerInput` (fired once step 0's run
   row is durably created); the workflow-start path awaits it before returning `{ runId }`, then
   lets `executeWorkflow` run in the background like `spawnWriteLoop`. AC: bare start unaffected;
   `{ steps }` dispatches and returns the first step's runId; both/neither rejected.
2. **Ownership guard** — derive the ownership key from the first identifiable step's
   `(project, branch)`; reuse the existing claim/queue guards so a workflow start cannot
   double-claim a worktree. AC: a workflow start whose first step is already claimed is rejected
   `worktree_claimed`.
3. **activeRuns discriminant + kill/pause** — add `kind: "write-loop" | "workflow"` to
   `activeRuns` entries; a workflow-kind entry carries no abort/pause controllers;
   `killHandler`/`pauseHandler` reject a workflow-started runId (and any later-step runid) with
   `run_not_active`. AC: kill/pause of a workflow-started run is rejected `run_not_active`.
4. **list rendering** — `list` renders per-step rows for a workflow-started run (reuse the
   existing per-step rendering), exercised against a run produced via `start`. AC: list shows
   per-step rows for a `start`-produced workflow run.

Each subspec carries its own Documentation updates for `v2/docs/daemon-host.md` (the `start`
row, admission guards, live-controls limitation) covering only its slice.

## Prerequisites

- `executeWorkflow` supports ordered multi-step execution with per-step attempt history.
- Daemon `start` currently accepts only a bare `WriteLoopInput`.

## Out of scope

- The `implement` preset itself (separate intent, already landed).
- CLI/operator launch surface (separate intent).
- New pause/resume/abort semantics beyond what `executeWorkflow` already defines.
