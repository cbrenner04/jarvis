# 00 - Commit progress iterations regardless of publishCompletion

## Problem

`commitProgressIteration` (`v2/src/execution/write-loop.ts:1373`) returns early when
`args.publishCompletion === false`. Every workflow write step sets exactly that
(`workflow-runner.ts:1396` via `prepareWorkflowStep`, `:1303` via
`buildCompletionStepWriteLoopInput`), overriding the authored step value
(`publication-workflow-steps.ts:334,568`). So workflow-driven runs never make per-iteration
commits: three implement runs on 2026-07-25 recorded progress boundaries and left 13–18 dirty
files with zero commits.

Nothing distinguishes "committed" from "skipped" in the run log either — `boundary_committed` is
a SQLite boundary event, not a git commit, and it fires either way.

The completion committer (`v2/src/execution/completion-commit.ts:76-85`) is not itself a clean
create/no-op signal: once any commit on the branch carries a `Jarvis-Agent:` trailer, a later
no-change call reuses HEAD and still returns a real `commitSha` — HEAD, which that call did not
create. Any per-iteration commit/skip logic, and the implement step's pre-shrink committer call
(`workflow-runner.ts:670-681`), must account for this.

## Decisions

- Drop `publishCompletion` from the `commitProgressIteration` guard; it gates completion
  publication (push/PR/ready), not in-flight committing. Rules out flipping workflow steps to
  `publishCompletion: true`, which would also enable per-step completion publication.
- Keep the `.git`-absent early return. It is load-bearing for no-commit intent steps, which run
  with `worktree.git: false`.
- Do not force a commit for a no-change iteration: the existing committer no-op
  (`shouldReuseHeadWithoutNewCommit`, `forceDistinctCommit` unset) stands.
- **Created-vs-reused discriminator**: at every call site that needs to know whether this call
  produced a *new* commit, capture `headBefore = git rev-parse HEAD` immediately before invoking
  the committer. Classify the result as:
  - `commitSha === undefined` → no commit ever existed to reuse; skip, `no_file_changes`.
  - `commitSha === headBefore` → the call reused an existing HEAD commit; skip, `no_file_changes`.
  - otherwise → the call created `commitSha` fresh; commit made.
  This is the only reliable signal — `CompletionCommitResult` alone conflates create and reuse.
- Apply the same discriminator to the implement step's pre-shrink committer call
  (`workflow-runner.ts:670-681`). Today that call always creates a fresh commit, so publication's
  later `reset --mixed <sha>^` (`:849-855`) correctly unwinds to pre-implement HEAD. With
  per-iteration commits, a clean tree at implement completion (the common case, since the last
  progress iteration already captured the work) makes that call reuse HEAD, and `<sha>^` would
  then unwind past the last iteration commit instead of to pre-implement HEAD. Fix: store
  `headBefore` (captured before the pre-shrink call) as the reset target directly, and reset to
  it — not to `<committerResult.sha>^` — regardless of whether the call created or reused. Content
  is never at risk (the reset is `--mixed` and the forced publication commit recommits the
  worktree either way); this only fixes what the reset unwinds to.
- The guard-removal is unconditional across every workflow step, including git-backed plan/intent
  steps. Their staging artifacts (`INTENT_STAGE`) are therefore committed in-flight by progress
  iterations the same as any other file, and removed by the landing step's own subsequent commit,
  same as today's terminal-commit behavior. No step-role scoping is added.
- Add a distinct log event for the per-iteration commit rather than extending
  `boundary_committed`; the two must stay separable because one is git and one is SQLite.
  Event carries the commit SHA when a commit was made, and the skip condition otherwise
  (`no_git` or `no_file_changes`).
- Emit the event on every `progress` iteration on the write-loop path, before the
  `boundary_committed` append, so ordering in the log reads commit-then-boundary.
- A committer error during a `progress` iteration is not given a distinct log event; it surfaces
  through the existing `loop_finished{iteration_commit_failed}` signal, unchanged.
- A committer error during a `progress` iteration now reaches the write loop's existing failure
  path (previously unreachable there, since the guard returned early). That failure result is
  already resumable and the step re-dispatches on retry like any other write-loop failure; no new
  handling is added.

## Task checklist

- [ ] Remove the `publishCompletion` condition from the `commitProgressIteration` guard.
- [ ] Capture `headBefore` before the committer call in `commitProgressIteration`; classify the
      result (created / reused-skip / no-git-skip) per the discriminator above; return the
      classification and append the new log event from the `progress` branch of the write loop.
- [ ] Capture `headBefore` before the implement step's pre-shrink committer call
      (`workflow-runner.ts:670-681`) and use it as the shrink-reset target in place of
      `${preShrinkCommit.sha}^` (`:849-855`).
- [ ] Add the event to the `LogEvent` union in `v2/src/persistence/log-stream.ts` and render it
      in `v2/src/tui/tui-log-follow-lines.ts`.
- [ ] Tests in `v2/src/execution/write-loop.test.ts` and `v2/src/execution/workflow-runner.test.ts`.
- [ ] Documentation updates below.

## Acceptance criteria

- [ ] A workflow write step (`publishCompletion: false`) that materializes file changes on a
      `progress` iteration and then fails mid-run leaves a non-empty `git log <base>..HEAD` on a
      real git fixture (not an injected `completionCommitter` double); a new test drives that path
      and fails against the pre-fix code (zero commits).
- [ ] A `progress` iteration whose worktree changed no files creates no commit; a test asserts
      zero new commits, and inverting the no-change guard fails it.
- [ ] A `progress` iteration that follows a committing iteration, and itself changes nothing,
      reports *skipped* (`no_file_changes`) rather than the prior iteration's SHA; a test drives
      two consecutive iterations (commit, then no-change) and fails against a naive
      `commitSha !== undefined` check.
- [ ] A `progress` iteration that commits emits a per-iteration commit log event reporting the
      commit and its SHA; an iteration skipped for no file changes, and one skipped for a missing
      `.git` (a step with `worktree.git: false`, as used by no-commit intent steps), each emit
      that event naming the skip condition instead. A test asserts all three cases are
      distinguishable and fails against the pre-fix code.
- [ ] Inverting the `.git`-absent guard fails a test that proves no commit is attempted against a
      `worktree.git: false` step.
- [ ] A completed implement step whose last progress iteration already committed the final tree
      (clean worktree at implement completion) still leaves the shrink/publication reset anchored
      at pre-implement HEAD, not at the last iteration commit; a test on a real git fixture drives
      this case and fails against a `<sha>^`-based reset.
- [ ] A git-backed plan or intent workflow run commits its staging-artifact changes in-flight via
      progress iterations, and the landing step's commit still removes those artifacts from the
      final tree; a test on a real git fixture pins this.
- [ ] Steps with `publishCompletion: false` still skip completion publication (no push, PR, or
      ready flip) while committing their progress iterations; an existing or updated test pins this.
- [ ] Existing completion tests in `v2/src/execution/write-loop.test.ts` and
      `v2/src/execution/workflow-runner.test.ts` stay green (normal completion publishes unchanged,
      no duplicate or orphaned commits).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — § Per-iteration commits: drop the `publishCompletion !== false`
  precondition, state what a mid-run failure retains, document the per-iteration commit/skip log
  event (including the created-vs-reused discriminator and that a no-change iteration following a
  commit reports skipped, not a stale SHA), and the `boundary_committed` distinction (SQLite
  boundary, not a git commit).
- `v2/docs/operator-runbook.md` — § Orphaned non-terminal runs after daemon restart: state the
  iteration-SHA guarantee now holding for workflow write steps and recovery after a mid-run failure.
- `v2/docs/v1-behaviors.md` — record the changed commit cadence for workflow write steps, including
  that git-backed plan/intent steps now commit staging artifacts in-flight (cleaned up by landing).
