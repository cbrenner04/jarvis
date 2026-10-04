# 02 - Decision-gated resume: revise

Add the `revise` decision: repeat an earlier step's write loop, consuming one of
that human step's configured revision budget, gated on a dirty worktree or an
injected free-text prompt.

## Prerequisites

- [01 - Decision-gated resume: approve/abort](./01-decision-resume-approve-abort.md) is
  merged: `resume`'s `decision` param exists and `revise` is currently rejected.

## Decisions

- Human step config gains optional `onRevise: { repeatStepId: string; maxRevisions: number }`,
  naming an earlier step in the same authored `steps[]` array and a revision
  budget — an open-ended revise with no bound and no target is out of scope.
  `maxRevisions` is this feature's realization of the intent's "the step's
  configured range... N": no write-step field carries a range/attempt-count
  concept today (subspec 00's write-step fields are `role`, `agents`,
  `stepRules`, `agentModelConfig`, `expectedArtifactPath` — none of them),
  so this is a new, human-step-scoped budget rather than an existing concept
  to fold into — ruling out overloading a write-step field that has no such
  semantics today.
- `repeatStepId` is validated against the workflow's authored `steps[]` at
  workflow-definition time (same place other cross-step config is validated):
  it must name an earlier step (index strictly less than the human step's own)
  in the same array. A missing, self-referencing, or forward-referencing
  `repeatStepId` is rejected at definition time with a `defineWorkflow`-level
  error — an operator-authored dangling reference is a config error, not a
  runtime one.
- `revise` spawns the named step's write loop again under a synthesized stepId
  (`${repeatStepId}~r<n>`) rather than reopening the original completed run
  row — reuses `findRunByProjectBranch`'s existing per-`stepId` identity model
  instead of adding a new `StateStore` "reopen completed run" primitive.
- `n` is derived by scanning existing run rows for the workflow's
  project/branch whose `stepId` matches `${repeatStepId}~r*`, taking the
  highest existing `r<n>` plus one (starting at 1) — a new `StateStore` query
  method, not a stored counter column, so there is no separate counter to keep
  in sync with the run rows themselves.
- `revise` requires either the repeated step's worktree to be git-dirty or an
  RPC-supplied `prompt` string; neither present rejects `revise_requires_input`.
- A supplied `prompt` is appended to the repeated step's `stepRules` for that
  revision attempt only — operator input is not silently discarded.
- A human step with no `onRevise` configured rejects any `revise` decision
  outright.
- Exhausting `maxRevisions` (all `~r1..~rN` stepIds already used) rejects further
  `revise` decisions with `revise_exhausted`.
- Add `isWorktreeDirty(worktreePath): boolean` (via `git status --porcelain`) —
  no git-dirty check exists yet in `v2/src` or `shared/`.
- While a `~r<n>` revision write loop is in flight, the human step's own run
  moves to a new status `"revising"` (added to `RUN_STATUSES`) instead of
  staying `awaiting-human` — an in-flight revision is not itself awaiting a
  decision, so overloading `awaiting-human` here would make `resume` ambiguous
  about whether a decision is currently accepted.
- `revise` is a loop iteration, not a dead end: when the `~r<n>` write loop
  reaches any terminal outcome (`completed`, `failed`, or `blocked`),
  `executeWorkflow` re-dispatches the human step by `stepId` — setting its run
  status back to `awaiting-human` — so a subsequent `resume` decision
  (approve/revise/abort) is reachable again against the same human step.
- Concurrent `resume` calls against the same run are serialized by the daemon's
  existing RPC handling, the same guarantee `kill`/`pause` already rely on —
  no new locking is added by this subspec.

## Acceptance criteria

- [x] `revise` on a human step with `onRevise` configured, called against a dirty
      worktree, spawns a write loop under stepId `${repeatStepId}~r1` reusing the
      repeated step's config, and moves the human step's run to `"revising"`.
- [x] `revise` on a clean worktree with no `prompt` param is rejected
      `revise_requires_input`.
- [x] `revise` on a clean worktree with a `prompt` param succeeds, and the
      spawned revision step's `stepRules` includes the supplied prompt text.
- [x] When the `~r1` revision write loop reaches a terminal outcome, the human
      step's run returns to `awaiting-human`, and a following `resume` call
      against it is accepted (not rejected as a terminal run).
- [x] A second `revise` issued after that re-convergence spawns stepId
      `${repeatStepId}~r2`; a step configured with `maxRevisions: 1` rejects a
      second `revise` with `revise_exhausted`.
- [x] `revise` on a human step with no `onRevise` configured is rejected
      regardless of worktree state or prompt.
- [x] Defining a workflow whose `onRevise.repeatStepId` is missing,
      self-referencing, or forward-referencing is rejected at definition time.

## Documentation updates

- `v2/docs/workflow-runner.md`: document `onRevise` config, `repeatStepId`
  validation, the revision stepId scheme, the `"revising"` status, and
  re-convergence to `awaiting-human` on terminal outcome.
- `v2/docs/daemon-host.md`: document the `revise` decision's `prompt` param,
  its error codes (`revise_requires_input`, `revise_exhausted`), the
  `"revising"` status, and resume-call serialization.
