# 01 — Pipeline stage settlement

Depends on [00](00-writer-flip-incident-predicate-and-resume.md) landing first: this subspec assumes `completion_commit_failed`/`ready_flip_failed` entry rows already settle `status: "failed"`.

`pipeline-stage-recovery.ts`'s `findBranchFailedWorkflowStage` (`:84-93`) matches a stage on `record.status === "failed"`, a rollup derived purely from `run.status` (`workflow-run-status-rollup.ts`). Today a `completed`-status entry row carrying these publication causes is invisible to it. Once subspec 00 lands, these rows become visible as failed stages for the first time, and `isPlanStageEntryRunRecoverable` (`workflow-runner-resume.ts:659-669`) treats any status other than `blocked`/`completed` as unconditionally recoverable (:665) — a freshly `failed` `ready_flip_failed` entry row would fall into that branch and become recoverable via `recoverPlanStage`, contradicting its non-resumable/terminal status from subspec 00.

## Decisions

- `isPlanStageEntryRunRecoverable` gets an explicit exclusion: a `failed` entry row whose terminal cause is `ready_flip_failed` is never recoverable — rules out the unconditional-`true` branch (`:665`) silently admitting it now that it reaches `failed` status for the first time.
- `completion_commit_failed` entry rows remain admitted through this path once `failed` (consistent with its resumability from subspec 00) — rules out excluding it alongside `ready_flip_failed`.
- `recoveryAttemptFailureDetail` (`pipeline-stage-recovery.ts:236+`) already special-cases `completion_commit_failed` by `outcome.code` and needs no change — carries the existing failure detail as-is.

## Tasks

- [ ] Add a guard (in `isPlanStageEntryRunRecoverable` or its caller) excluding a `failed` entry row whose terminal cause is `ready_flip_failed` from plan-stage recovery admission.
- [ ] Confirm `findBranchFailedWorkflowStage` and `resolveBlockedPlanStageRecoveryTarget` correctly surface a `failed` `completion_commit_failed`/`ready_flip_failed` entry row as a failed stage now that it's reachable, without treating `ready_flip_failed` as recoverable.
- [ ] Update existing pipeline-stage-recovery tests keyed on these rows never appearing as failed stages.

## Acceptance criteria

- [x] A test proves a pipeline branch with a `failed` `ready_flip_failed` entry row is surfaced as a failed stage but `resolveBlockedPlanStageRecoveryTarget` refuses recovery for it; it fails against the pre-fix code, where the row is `completed` and `findBranchFailedWorkflowStage` never finds it as failed at all.
- [x] A `pipeline-stage-recovery.test.ts` test pins that a `failed` `completion_commit_failed` entry row is surfaced as a failed stage and admitted for recovery. It seeds that row directly rather than producing it through the changed writer, so it does not fail against pre-fix code: a real drive cannot reach a plan *entry* row carrying a publication `terminalCause`, because `isDurableWorkflowStep` makes a `review-debate` step unconditionally durable and the failure settles on the review row instead. The writer behavior itself is proven pre-fix-failing by `workflow-runner-publication.test.ts` (`ready_flip_failed settles failed with atomic non-resumable cause`). Driving the daemon-side row through `workflow-runner-resume.ts`ʼs publication path is deferred.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

None beyond subspec 00 — no doc currently describes pipeline-stage recovery admission for these two causes.
