---
name: workflow-steps-commit-each-progress-iteration
---

# Workflow write steps commit each progress iteration

## Problem

Three implement runs on 2026-07-25 recorded progress boundaries and left zero commits with 13–18
dirty files; 20–70 minutes of agent work each, recoverable only by hand-committing.

Cause, from the code: `prepareWorkflowStep` (`v2/src/execution/workflow-runner.ts:1396`) and
`buildCompletionStepWriteLoopInput` (`:1303`) set `publishCompletion: false` on every workflow step's
write-loop input, overriding the authored step value (`publication-workflow-steps.ts:334,568`).
`commitProgressIteration` returns early on exactly that condition, so per-iteration commits never
run for workflow-driven runs — the intended reach of
`v2/spec/completed/20260724T211609Z-commit-each-write-iteration`.

`v2/docs/operator-runbook.md` § Orphaned non-terminal runs promises surviving iteration SHAs on the
branch; that promise did not hold.

## Decisions

- Decouple per-iteration committing from `publishCompletion`. `publishCompletion` gates completion
  publication (PR/ready), not whether in-flight work is committed; conflating them is what suppressed
  the commits. Rules out flipping `publishCompletion: true` on workflow steps, which would also turn
  on completion publication per step.
- Keep the `.git`-absent early return — non-git worktrees have nothing to commit.
- An iteration that changed no files makes no commit, empty or otherwise.
- A run that completes normally publishes the same result; no duplicate or orphaned commits.
- Emit a per-progress-iteration log event naming whether a commit was made and, when skipped, the
  skipping condition (no `.git`, or no file changes — `publishCompletion` is no longer a skip
  condition after this change). `boundary_committed` remains a state-store boundary
  (`store.commitCompletionBoundary`), not a git commit; this event is what distinguishes the two
  going forward.
- Out of scope: whether `--reset-despite-dirty` should stash rather than discard.

## Acceptance criteria

- [ ] A workflow write step that produces file changes and then fails mid-run leaves a non-empty
      `git log <base>..HEAD`; a regression drives a failure after at least one progress iteration and
      fails against the pre-fix code (zero commits).
- [ ] A progress iteration that changed no files creates no commit; inverting that guard fails a test.
- [ ] A progress iteration that commits emits a log event reporting the commit and its SHA; a
      progress iteration skipped for having no file changes (or no `.git`) emits a log event naming
      that condition instead. A test asserts the two cases are distinguishable and fails against the
      pre-fix code.
- [ ] Existing completion tests in `v2/src/execution/write-loop.test.ts` and
      `v2/src/execution/workflow-runner.test.ts` stay green (normal completion publishes unchanged).
- [ ] Steps with `publishCompletion: false` still skip completion publication while committing their
      progress iterations.

## Documentation updates

- `v2/docs/write-behavior.md` — when the write loop commits, what a mid-run failure retains, and the
  per-iteration commit/skip log event (including that `boundary_committed` is a state-store boundary,
  not a git commit).
- `v2/docs/operator-runbook.md` — § Orphaned non-terminal runs: state the iteration-SHA guarantee that
  now holds and recovery after a mid-run failure.
- `v2/docs/v1-behaviors.md` — record the changed commit cadence for workflow write steps.

## Prerequisites

- Write loop invokes a per-iteration commit path on `progress` results
- Workflow runner builds write-loop inputs for authored steps
- A completion committer commits worktree changes on the run branch
