# 00 — Resume a resumable implement row in place

## Problem

`pipeline resume` reopens every failed workflow stage for re-dispatch. A failed implement stage whose durable workflow rollup is owned by a write row advertising `nextAction: resume` therefore loses its `workflowInvocationId` and runs fresh preflight against a lane that has already checkpointed work; an advanced base can then make that preflight fail instead of resuming the retained row.

## Decisions

- Resolve the failed implement stage's workflow rollup cause row (`resolveWorkflowRunRollup`'s `causeRun`, the same row `settleLinkedStagesFromEntryRunWith` attributes failure to) from its linked entry run and invocation siblings — a distinct sibling row when the entry step itself succeeded and a later step failed — then use that row's canonical operator error to detect `nextAction: resume`; rules out assuming the entry row itself failed, resuming the entry row instead of the sibling that actually failed, or trusting copied stage `failureDetail` after durable run state changes.
- Send a qualifying cause row through the same run-resume lifecycle and admission as `jarvis run resume`; rules out duplicating only the admission predicate while skipping reconstruction, ownership, or linked-workflow continuation.
- Leave the failed stage linked to its existing `workflowInvocationId` (the entry run) until run-resume admission reopens it; the stage link never repoints to the cause row's own id. Rules out `reopenFailedPipeline`, stage re-linking, stale-reset preflight, and fresh workflow dispatch on this path.
- Pass the failed stage's `pipelineId`/`stageId` into the failed-stage reopen step admission takes, so it reopens this stage even when the pipeline is dismissed; only the callerless blanket sweep (plain `jarvis run resume` with no known pipeline) still skips dismissed pipelines. Rules out a dismissed pipeline's resumed row settling against a stage stuck `failed` forever — dismissal is display-only, not a hold on recovery.
- Return run-resume refusal details through the existing `ResumePipelineOutcome` `{ kind: "refused" }` envelope, carrying the run-resume admission's reason/message unchanged and the CLI's existing nonzero-exit refusal behavior — widen `ResumePipelineOutcome`'s `refused` `reason` (today pipeline-resume reasons only, `v2/src/daemon/pipeline-execution.ts:185-193`) to admit the run-resume admission reasons plus an optional `message`, and do not map them onto existing pipeline reasons; without a re-dispatch fallback; rules out racing a changed or already-running row into a new workflow invocation after admission rejects it, and rules out a new refusal shape the CLI doesn't already render.
- Keep failed `intent` and `plan` stages, and failed implement stages without an admitted `nextAction: resume` row, on existing re-dispatch behavior; rules out bypassing plan redraft/reset semantics or changing non-resumable recovery.
- Let the resumed row's existing settlement path continue the pipeline after success; rules out an additional `continuePipeline` call from `pipeline resume` that could dispatch a successor twice.

## Tasks

- [x] Route qualifying whole-pipeline and branch-scoped failed implement resumes through the shared run-resume lifecycle before failed-stage reopen, passing the target pipeline/stage so reopen admits it regardless of pipeline dismissal.
- [x] Preserve the current re-dispatch path for every non-qualifying failed stage and propagate run-resume refusal details unchanged through `ResumePipelineOutcome`.
- [x] Add focused daemon regressions for successful in-place resume (unscoped and branch-scoped), refused admission, and dismissed-pipeline resume.
- [x] Update the operator and durable behavior contracts.

## Acceptance criteria

- [x] `v2/src/daemon/daemon-pipeline-resume.test.ts` proves unscoped `pipeline_resume` on a failed implement stage whose workflow rollup cause row — a distinct invocation sibling of the entry run — settled `gate_invocation_refused` with a non-`slot_contention` `gateRefusalRecoveryState.cause` (e.g. `ceiling_headroom`, so automatic slot re-drive cannot also claim it) resumes that exact sibling row, leaves the stage's `workflowInvocationId` (the entry run) unchanged, performs no workflow dispatch or stale-reset preflight, and creates no replacement worktree after the base advances past the lane's merge base; it fails against the pre-fix re-dispatch path.
- [x] A branch-scoped variant of the above passes `branchKey` to `pipeline_resume`, resumes the exact same cause-row sibling on that branch, and leaves every sibling lane's stage rows and `workflowInvocationId` byte-identical; it fails against the pre-fix re-dispatch path.
- [x] A test dismisses the pipeline first, then proves `pipeline_resume` still resumes the qualifying row in place with the stage reopened to `running` (not left `failed`); it fails against a reopen step that inherits the blanket sweep's dismissed-pipeline skip.
- [x] `v2/src/daemon/daemon-pipeline-resume.test.ts` proves a qualifying row whose run-resume lifecycle refuses returns a `ResumePipelineOutcome` of `{ kind: "refused", ... }` carrying that admission's reason/message unchanged (a run-resume reason, not a mapped pipeline reason), producing the CLI's existing nonzero-exit behavior, leaves the failed stage and link unchanged, and performs no workflow dispatch; it fails against a fallback to re-dispatch.
- [x] `v2/src/daemon/pipeline-execution.test.ts` test `re-dispatches only the failed continuation stage and preserves predecessor invocation IDs` stays green, pinning non-resumable re-dispatch behavior.
- [x] `v2/docs/operator-runbook.md`, `v2/docs/pipeline-execution.md`, and `v2/docs/v1-behaviors.md` record that `pipeline resume` resumes a resumable failed implement write row in place (including for a dismissed pipeline), while non-resumable failed stages still re-dispatch and admission refusal does not fall back.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — operator behavior and refusal recovery for resumable failed implement stages, including dismissed pipelines.
- `v2/docs/pipeline-execution.md` — in-place implement-row resume admission and re-dispatch boundary.
- `v2/docs/v1-behaviors.md` — changed v2 pipeline-resume behavior versus the prior unconditional failed-stage re-dispatch.
