# The write loop commits nothing to git until completion, so a late failure loses every iteration

## Problem

`boundary_committed` in a run log is a **state-store** boundary, not a git commit.
`finishIteration` / `finishIterationTimeout` / `finishExecuteWriteThrow` all call
`store.commitCompletionBoundary(...)` (SQLite) and append a `boundary_committed` log event; the only
git commit comes from `completionCommitter` on the `complete` path (`v2/src/execution/write-loop.ts`).

So a multi-iteration run accumulates **all** its work uncommitted in the worktree. Any failure before
completion — `iteration_timeout`, `role_stalled`, a contract miss — leaves the entire run's output as
dirty files with zero commits, and the documented recovery (`--reset-despite-dirty`) discards it.

Observed three times on 2026-07-25, each losing 20–70 minutes of agent work:

| run | boundaries reported | git commits | dirty files |
| --- | --- | --- | --- |
| intent-finalization attempt 2 | 3 steps, 2 recording `outcomeKind: "done"` / `runStatus: "completed"` | 0 | 13 |
| intent-finalization attempt 3 | 7 iterations across 3 steps | 0 | 13 |
| write-path-idle-output-watchdog | link-0 first pass `ok` (19.2 min) | 0 | 18 |

Each was recoverable only by an operator hand-committing the worktree, gating it, and opening a PR
by hand. Two of the three were recovered that way; the third is still stranded.

This also makes two operator-facing claims false:

- `v2/docs/operator-runbook.md` § Orphaned non-terminal runs: "Committed iteration SHAs on the same
  branch also survive kill, daemon reconcile, and resume while the branch exists; only in-flight edits
  before that iteration's git commit may be lost." On this path there are no iteration SHAs.
- A row recording `boundary_committed` with `outcomeKind: "done"` reads to an operator as "the work is
  committed". It is not.

Related but distinct: `shrink-invocation-error-preserves-write-work` (#1836) commits write output
before the shrink pass — a single special case, not a general per-iteration commit.

## Decisions

- A write iteration that produced file changes commits them to the run's branch at its boundary, so a
  later failure loses at most the current in-flight iteration. Rules out the present all-or-nothing
  model where a failure at iteration N discards iterations 1..N.
- Iteration commits are ordinary commits on the run branch, replaceable by the completion commit's
  squash/amend at publication; rules out a parallel stash or patch store the operator cannot see with
  `git log`.
- Do not rename or repurpose the existing `boundary_committed` log event as part of this change —
  its meaning (state-store boundary) is correct; the fix is that git commits actually happen. Any
  naming change is separable and must not be bundled here.
- Out of scope: whether `--reset-despite-dirty` should stash rather than discard.

## Acceptance criteria

- [ ] A write loop that completes iteration 1 with file changes and then fails in iteration 2 leaves
      iteration 1's changes committed on the branch; a test asserts a non-empty `git log <base>..HEAD`
      after the failure, and fails against pre-fix code (which commits nothing).
- [ ] An `iteration_timeout` after N successful iterations retains those N iterations' commits.
- [ ] A run that completes normally still produces the same published result as today (no duplicate or
      orphaned commits in the PR), verified against an existing completion test.
- [ ] An iteration that changed no files creates no empty commit.
- [ ] `v2/docs/operator-runbook.md` § Orphaned non-terminal runs no longer claims iteration SHAs
      survive when none are created; it describes the actual guarantee after this change.

## Documentation updates

- `v2/docs/write-behavior.md` — when the write loop commits, and what a failure retains.
- `v2/docs/operator-runbook.md` — correct the iteration-SHA survival claim; recovery after a mid-run
  failure.
- `v2/docs/v1-behaviors.md` — record the changed commit cadence.
