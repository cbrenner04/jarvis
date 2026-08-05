---
name: pipeline-stage-settlement-honesty
---

# Stage settlement can terminalize a live run, downgrade run errors, and die on a merged base branch

One bundle: both defects are the same surface — what a pipeline stage row records when its linked
run settles or fails (`v2/src/daemon/pipeline-stage-dispatch.ts`,
`v2/src/execution/pipeline-execution.ts`). Absorbs `entry-run-settlement-terminalizes-live-rows`
and `pipeline-implement-stage-breaks-when-its-plan-pr-merges` (2026-08-04).

## Problem A — settlement terminalizes a live-linked stage; one guard from the fix is inert

PR #2566 stopped the ordered-progression and fan-out writers from terminalizing a stage whose
`workflowInvocationId` names a live entry run. It did not guard the **writer** that records the
terminal patch. `applyEntryRunSettlement` (`pipeline-stage-dispatch.ts:135-142`) writes
`status: "failed"` and `endedAt` on any non-`completed` rollup with no `isLiveEntryRun` re-check.
It trusts `wait` — but `waitForWorkflowEntryRun` (`daemon.ts:1758`) **awaits nothing** when
`workflowPromisesByEntryRunId` has no entry for the run: it rolls up `isLive: false` and
`rollupWorkflowRunStatus` (`workflow-run-status-rollup.ts:38-45`) returns the in-flight step's
`in-progress`, or `"killed"` for a step row that does not exist yet. So `wait` can resolve
non-`completed` over a run that is still live, and the stage is terminalized anyway. Because
`adoptAndSettlePipelineStage` can write linkage and settle in the same tick, this is also the one
remaining path to `startedAt == endedAt` — the signature observed 2026-08-03. In-process dispatch
is safe (the promise registers at `daemon.ts:1089` before resolve); the exposure is the
cross-process / post-restart adopt path — precisely the case #2566's adoption machinery serves.

Smaller: `failWorkflowStageAt` (`pipeline-execution.ts:1039`) carries a live-linkage guard whose
failure state is unreachable — all three call sites pass the same `stageRecords` snapshot from
which the caller already established the row is not `running`, so the guard can never observe
`running` and no mutation can kill it. Mandated by subspec 01's Decisions, so it is the spec asking
for a guard against a condition that cannot occur — the same shape as the retired
`destinationDistinctFromPredecessor`. Related: `plan-review-must-falsify-guard-premises`.

## Problem B — merging the pipeline's own plan PR kills the implement stage, and the failure is downgraded

A `full-review` implement stage opens its draft PR with `--base <plan stage branch>` — a stacked
chain nothing documents or guards. The runbook directs the operator to merge each green PR as it
lands, and a squash merge deletes the head branch, so merging the pipeline's own plan PR removes
the base ref the implement stage is about to target. Observed 2026-08-03, pipeline `3b97c231`
(seed `surface-the-completion-commit-error-instead-of-swallowing-it`): plan PR #2547 merged, then

```text
Command failed: gh pr create --draft --base plan/persist-completion-commit-error-in-loop-log …
pull request create failed: GraphQL: Head sha can't be blank, Base sha can't be blank, …
  Base ref must be a branch (createPullRequest)
```

The stage recorded `harness_failure` / retryable: false / `nextAction: "stop"` and the pipeline
derived terminal `failed` — while `jarvis run wait` on the owning run reported
`completion_commit_failed`, retryable, `nextAction: "resume"`. The completion commit was not lost,
but no PR existed and recovery was a hand rebase onto `main` (#2549). (The same failure also showed
the stage linked to the wrong run with `startedAt == endedAt`; stage-to-run linkage identity has
since been reworked by settlement-first fan-out terminality, #2590/#2591 — verify remaining linkage
scope at plan time.)

## Decisions

- `applyEntryRunSettlement` re-checks `isLiveEntryRun` immediately before writing a non-success
  terminal patch, and declines to terminalize a still-live run — rules out `wait` resolving
  non-`completed` over a live entry run and stamping `endedAt` on it. The declined case is reported
  so a stage that cannot settle is visible rather than silently `running` forever.
- Prefer fixing the `wait` contract at its source if that proves cleaner than a defensive re-check:
  `waitForWorkflowEntryRun` returning a rollup for a run it never awaited is the underlying defect.
  Decide during planning, not implementation.
- Delete the inert `failWorkflowStageAt` guard, or give it a call site whose record can be
  `running` — rules out retaining a guard no mutation can kill. Deleting requires no behavior
  change.
- An implement stage whose configured base ref no longer exists on the remote falls back to the
  repository base rather than failing publication; the retarget is reported on the stage artifact —
  rules out a merged intermediate PR killing the pipeline.
- A stage failure reason is derived from its owning run's operator error, not replaced by a generic
  `harness_failure` — rules out a stage advertising `stop`/non-retryable over a run that is
  `resumable: true`.
- The stacked-PR chain (implement based on the plan stage branch) is stated in the pipeline
  documentation with its merge-order constraint — rules out an operator learning it from a failed
  pipeline.
- Out of scope: concurrent sibling dispatch, the dispatch claim window, `derivePipelineState`
  terminality, and stage-to-run linkage identity (largely landed via settlement-first fan-out
  terminality, #2590/#2591).

## Acceptance criteria

- [ ] A non-`completed` rollup for an entry run that is still live does not write `failed` or
      `endedAt` on the stage; a regression fails against the current writer, which terminalizes
      unconditionally.
- [ ] A non-`completed` rollup for a genuinely settled entry run still records the composed operator
      error exactly as today.
- [ ] A stage adopted after daemon restart, whose entry run has no registered workflow promise, is
      not terminalized while that run is live — the cross-process path, driven through
      `waitForWorkflowEntryRun` rather than a stubbed `wait`.
- [ ] No stage row can be written with `endedAt` equal to its own `startedAt` while its linked entry
      run is live.
- [ ] `failWorkflowStageAt` has no unreachable live-linkage guard: either it is removed, or a
      regression constructs a call reaching it with a `running` record.
- [ ] An implement stage whose base branch is absent from the remote publishes against the
      repository base instead of failing; a regression fails against the baseline `gh pr create`
      invocation and asserts the resolved base.
- [ ] The retarget is recorded on the stage artifact (or its failure detail when it still fails),
      naming both the requested and resolved base.
- [ ] A base ref that exists is still used unchanged — no unconditional retarget to the repository
      base.
- [ ] A stage whose owning run settled a retryable operator error reports that reason and
      `nextAction` on the stage row rather than `harness_failure` / `stop`; a regression covers the
      `completion_commit_failed` case.
- [ ] Mutation checkpoints: `// @mutate` directives removing the settlement liveness re-check and
      removing the base-existence check each turn their pinning regression RED.
- [ ] `bun run typecheck`, `bun run check`, `bun run test:v2`, and `bun run test:integration:v2`
      exit zero.

## Documentation updates

- `v2/docs/daemon-host.md` — settlement declines to terminalize a live entry run; what `wait`
  guarantees and what it does not; stage failure reasons mirror the owning run's operator error.
- `v2/docs/operator-runbook.md` — correct the "stays `running` until the entry run settles" claim
  for `paused` runs (not terminal, so they read as live); § Pipeline start — implement stacks on
  the plan stage branch, what happens if that branch merges first, and the retarget behavior.

## Prerequisites

- #2566 (`20260803T190421Z-stage-entry-run-linkage`) shipped `liveLinkedEntryRunId`,
  `adoptAndSettlePipelineStage`, and the guards this seed extends
- Pipeline stage dispatch resolves each stage's base ref and passes it to workflow admission
  (`v2/src/execution/pipeline-stage-resolve.ts`, `pipeline-execution.ts`)
