# intent-reviewed reviews the wrong tree and fails silently

`intent-reviewed` is documented as the recommended v2 intent workflow, but with a
git-enabled project it never produces a ready-intent.

## Problem

`buildReviewedIntentWorkflowSteps` derives the review step's directory from
`splitStep.worktree?.projectRoot` (`v2/src/execution/intent-workflow-steps.ts:336`)
— the operator's *checkout* — and uses it for `cwd`, `verdictPath` (`:359`), and
`deferredIntentOutput.stagingDir` (`:370`). The split step writes into the
*external worktree* (`~/.jarvis/worktrees/<project>/intent/<slug>/`). Two different
directories.

`plan-reviewed` gets this right via `resolvePlanReviewCwd` →
`getExternalWorktreePath` (`plan-workflow-steps.ts:311-316`, `:328`).
`intent-workflow-steps.ts` never even imports the helper.

Consequences observed:

1. Landing is deferred when review is the last step (`workflow-runner.ts:637`), so
   the split output is still only staged in the external worktree.
2. The review critic/actuator run in the operator's checkout against an empty
   staging dir. `snapshotWorkingTree(projectRoot)` snapshots the operator's repo,
   and boundary enforcement can flag the operator's own dirty files as
   unauthorized and `restoreWorkingTree` them — **it can revert real work.**
3. `landReviewedIntentOutput` then reads `<projectRoot>/.jarvis-intent-stage`,
   which does not exist → `intent: .jarvis-intent-stage is missing`.
4. That message is dropped: `ReviewStepOutcome` (`workflow-runner.ts:1210-1223`)
   carries no error field, so `runStandardReviewStep` returns a bare
   `invocation_failure`. Hence "fails silently after the write step."

## Scope

- Resolve the intent review step's `cwd`, `verdictPath`, and `stagingDir` from
  `getExternalWorktreePath`, mirroring `resolvePlanReviewCwd`.
- **`jarvisRoot` must be threaded.** Unlike the plan write step
  (`plan-workflow-steps.ts:272`), the intent write step does not set `jarvisRoot`
  on the step (`intent-workflow-steps.ts:264-283`) — `input.jarvisRoot` is only
  used locally in `resolveOutput` (`:202`). Plumb it (or the already-correct path
  `resolveOutput` computes at `:204-209`) out of `buildIntentWorkflowSourceStep`,
  or tests injecting a temp `jarvisRoot` will silently resolve to `~/.jarvis`.
- Honor the `git:false` branch of the helper (`localPath`), not just the git one.
- **Surface the landing error.** Give `ReviewStepOutcome` a failure message and
  propagate it, so a landing failure names its cause instead of a bare
  `invocation_failure`.

## Decisions

- Mirror the plan preset's shape rather than inventing a new resolution path —
  the two should not diverge again.
- `intent-workflow-steps.test.ts:210` / `:217` currently assert the buggy
  project-root paths; they must be updated to the external worktree, not deleted.

## Out of scope

- Changing where split output is staged, or the deferred-landing design.
- Split-only `intent` preset (it lands correctly today).

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` — "Review an intent seed": confirm the
  git-enabled path actually publishes.
- `v2/docs/workflow-runner.md` — review-step cwd/staging contract.
