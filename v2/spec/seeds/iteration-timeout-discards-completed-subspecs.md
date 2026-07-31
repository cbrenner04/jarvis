---
name: iteration-timeout-discards-completed-subspecs
---

# An iteration timeout discards completed subspec work

## Problem

`iteration_timeout` settles `resumable: false`, `nextAction: "stop"`. The documented recovery
is a fresh `jarvis run workflow implement`, whose preflight retires the stale workspace —
removing the worktree, the local branch, and the remote branch — and rematerializes from
`--base`. On a multi-subspec spec that destroys every subspec the run already finished.

Observed 2026-07-30 on `20260730T225359Z-pipeline-stage-resolve-prior-worktree` (3 subspecs):
the run settled `iteration_timeout` with subspecs **00 and 01 complete** — all 11 acceptance
criteria ticked, index entries checked, three iteration commits on the branch — and only 02
partly done. Re-dispatching would have redone ~40 minutes of landed work. Recovery was an
operator hand-finish and a hand-authored PR (#2363), bypassing the harness entirely.

Second occurrence of the class: the prior session's slice 6 ran 45 min on one iteration,
settled `iteration_timeout` with the work substantially done and **zero** criteria ticked,
and was also hand-finished (#2352). The two differ in an important way — slice 6 lost nothing
durable because nothing was ticked; this one had durable, committed, ticked subspecs at risk.

Raising `iterationTimeoutMs` / `iterationCeilingMs` (queue's carried operator note) reduces the
frequency but not the data loss: any spec large enough to time out is a spec whose partial
progress is worth keeping.

## Decisions

- An `iteration_timeout` on an implement run whose spec tree has at least one **fully
  satisfied** subspec is recoverable by continuing from the retained worktree, not only by a
  fresh run that resets it — rules out "re-dispatch and redo" as the sole documented recovery.
- Recovery reuses the existing branch, worktree, and iteration commits; it does not
  rematerialize from `--base` — rules out any path that deletes the branch before the operator
  has salvaged it.
- The timeout settle names which subspecs were completed and which remain, so the operator can
  decide between continue and restart without reading the worktree — rules out an opaque
  `iteration_timeout` with no completion inventory.
- The stale-workspace preflight **refuses** to retire a workspace whose spec tree has ticked
  criteria not present on `--base`, naming them, unless the operator passes an explicit
  override — rules out silent destruction of landed subspec work on the next dispatch.
- Whether recovery is `jarvis run resume` or a distinct re-entry is open; prefer `resume`
  (fold into the existing command per the north star) — pin at implementation.
- Out of scope: changing the timeout values themselves, and the wall-segment/ceiling escalation
  model. This seed is about not losing work when the bound is hit.

## Acceptance criteria

- [ ] An implement run that settles `iteration_timeout` with at least one subspec's
      non-human-only criteria fully ticked reports `resumable: true` on `jarvis run list` /
      `jarvis run wait`, with `nextAction: "resume"`; a run with no completed subspec keeps the
      current `resumable: false` / `stop` settlement. Inverting the completed-subspec predicate
      makes the regression red.
- [ ] The `iteration_timeout` operator error carries a completion inventory naming each
      completed subspec path and each remaining one; a test pins both lists against a spec tree
      with one complete and one incomplete subspec.
- [ ] Resuming such a run continues on the retained branch and worktree — no
      `resetStaleWorkspace`, no rematerialization from `--base` — and the pre-existing iteration
      commits are still reachable from the branch head after the resume settles.
- [ ] `resetStaleWorkspace` refuses to retire a workspace when the managed worktree's spec tree
      has criteria ticked that are unticked on `--base`, names those subspec paths on stderr,
      and changes nothing; the documented override flag proceeds. A regression covers both.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — `iteration_timeout` is conditionally resumable;
  when it is, resume continues the retained worktree rather than restarting the spec.
- `v2/docs/operator-runbook.md` § Recovery — replace the "re-run the spec" guidance for
  `iteration_timeout` with the completed-subspec decision, and document the new retirement
  refusal and its override.
- `v2/docs/v1-behaviors.md` — record the changed `iteration_timeout` resumability contract.

## Prerequisites

- `resetStaleWorkspace` preflight on incomplete implement/plan re-runs
- Per-iteration commit checkpointing on every settled main-loop iteration (fixed 2026-07-27)
- The spec.criteria-ticked completion contract and index routing
