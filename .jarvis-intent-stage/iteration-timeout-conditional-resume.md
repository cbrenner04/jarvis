---
name: iteration-timeout-conditional-resume
---

# An `iteration_timeout` that already finished subspecs is resumable, not discardable

`iteration_timeout` settles `resumable: false`, `nextAction: "stop"`, and the documented recovery is a
fresh implement run whose preflight retires the stale workspace — worktree, local branch, remote branch
— and rematerializes from `--base`. On a multi-subspec spec that destroys every subspec the run already
finished. Observed 2026-07-30 on `20260730T225359Z-pipeline-stage-resolve-prior-worktree`: subspecs 00
and 01 complete (11 criteria ticked, three iteration commits on the branch), only 02 partial;
re-dispatch would have redone ~40 minutes of landed work, and recovery was a hand-finish (#2363).
Second of the class after slice 6 (#2352). Raising timeout values reduces frequency, not data loss.

## Decisions

- An `iteration_timeout` with at least one subspec's non-human-only criteria fully ticked settles
  `resumable: true` / `nextAction: "resume"`; a run with no completed subspec keeps `stop` — rules out
  "re-dispatch and redo" as the sole recovery, and rules out advertising resume for a timeout with
  nothing to preserve.
- Recovery folds into `jarvis run resume` rather than a new re-entry command — rules out growing the
  command surface for one recovery path (north star: fewer steps, not more commands).
- Resume continues on the retained branch and worktree, with no `resetStaleWorkspace` and no
  rematerialization from `--base` — rules out a resume that retires the very commits it is preserving.
- The settlement carries a completion inventory naming each completed and each remaining subspec path —
  rules out an opaque timeout the operator must reconstruct from the log.
- The completed-subspec predicate is the shared fully-ticked criteria predicate — rules out a timeout
  inventory that disagrees with the router about what is done.
- Out of scope: the timeout values themselves.

## Acceptance criteria

- [ ] An implement run settling `iteration_timeout` with at least one subspec's non-human-only criteria
      fully ticked reports `resumable: true` / `nextAction: "resume"` on `run list` and `run wait`; a run
      with no completed subspec keeps `resumable: false` / `stop`.
- [ ] The `iteration_timeout` operator error carries a completion inventory naming each completed and
      each remaining subspec path; a test pins both lists against a tree with one complete and one
      incomplete subspec.
- [ ] Resuming such a run continues on the retained branch and worktree — no `resetStaleWorkspace`, no
      rematerialization — and the pre-existing iteration commits are still reachable from the branch head
      after the resume settles.
- [ ] Mutation checkpoint: inverting the completed-subspec predicate turns its pinning test RED.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — `iteration_timeout` is conditionally resumable.
- `v2/docs/operator-runbook.md` § Recovery — replace the "re-dispatch the workflow" guidance for
  `iteration_timeout` with the completed-subspec decision and the resume path.
- `v2/docs/v1-behaviors.md` — record the changed `iteration_timeout` resumability contract.

## Prerequisites

- A subspec's completeness is decided by a shared fully-ticked non-human-only criteria predicate.
- The router selects the first linked subspec with an unticked non-human-only acceptance criterion, independent of its index checkbox.
- A write step resolving `no-work` over uncommitted tracked paths settles a non-`completed` status naming those paths.
- The implement preflight refuses to retire a workspace whose spec tree carries criteria ticked that are unticked on `--base`.
- `composeRunOperatorError` maps `iteration_timeout` to a reason, `nextAction`, and recovery line projected by `run list` and `run wait`.
- `jarvis run resume` continues an admitted terminal run from its persisted workflow snapshot.
