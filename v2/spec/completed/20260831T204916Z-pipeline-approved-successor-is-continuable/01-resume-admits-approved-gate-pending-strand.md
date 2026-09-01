# Resume admits an approved-gate pending strand

## Primary implementation surface

Daemon pipeline continuation and resume admission in `v2/src/daemon/pipeline-execution.ts`.

## Prerequisites

- Subspec 00 — default-lane continuation scope normalization lands first so resume and approval share one continuation contract.

## Problem

`pipeline resume` refuses a durable shape with a reachable `approved` gate and an undispatched pending workflow successor (`pipeline_not_resumable`), leaving daemon-restart continuation as the only recovery when approval continuation did not run or was lost.

## Decision ledger

- Admit pending-strand recovery only from a reachable `approved` gate followed by its first pending workflow successor; rules out a new durable status or recovery marker and rules out admitting arbitrary derived `pending` pipelines.
- Unscoped and explicit-default `pipeline resume` use aggregate admission; named-lane resume uses branch-local classification in `scanBranchSuffixForAdmission` / `resolveBranchResumeAdmission` that admits the approved-gate pending strand; rules out relying on the aggregate detector alone for named-lane resume and rules out cross-lane dispatch or reopening unrelated failed stages.
- Named-lane approved-gate admission continues via `continuePipeline` without `reopenFailedPipeline`; rules out the current branch path that always reopens failed stages and refuses with `no_failed_stage` on this strand.
- Unscoped and explicit-default pending-strand recovery does not apply when aggregate derived state is `awaiting-approval`; rules out dispatching a ready lane while another branch still awaits approval; mixed fan-out recovery for that shape is named-lane-only.
- Preserve `pipeline_terminal_succeeded` and `pipeline_terminal_rejected` refusals; rules out widening pending recovery to terminal pipelines or replacing their specific diagnostics with `pipeline_not_resumable`.
- Daemon-restart continuation via `recoverContinuablePipelines` for this shape stays unchanged; rules out requiring convergence with live approve/resume fixes.

## Tasks

- Add one approved-gate pending-strand detector for unscoped aggregate admission in `pipeline-execution.ts`.
- Extend `scanBranchSuffixForAdmission` / `resolveBranchResumeAdmission` to classify the approved-gate pending strand as resumable on the named-lane path.
- Extend `resumePipeline` and branch-scoped admission to `continuePipeline` that strand without `reopenFailedPipeline`.
- Add unscoped, explicit-default, and named-lane regression coverage proving successor run linkage and unchanged sibling lanes.
- Add mixed fan-out negative regression coverage proving unscoped and explicit-default resume do not dispatch a ready lane under aggregate `awaiting-approval`.
- Update resume admission docs in the durable homes listed below.

## Acceptance criteria

- [x] `pipeline-execution.test.ts` proves unscoped and explicit-default `resumePipeline` admit an approved-gate plus pending-successor strand, create the successor run linkage, and fail against the pre-fix `pipeline_not_resumable` refusal.
- [x] `daemon-pipeline-resume.test.ts` proves unscoped and explicit-default `pipeline_resume` admit the same strand and create the successor run linkage; it fails against the pre-fix `pipeline_not_resumable` refusal.
- [x] `pipeline-execution.test.ts` proves named-lane `resumePipeline` admits the strand only for the requested lane, continues via `continuePipeline` without `reopenFailedPipeline`, and leaves sibling gates and stages unchanged; it fails against the pre-fix `branch_not_resumable`, `pipeline_not_resumable`, or `no_failed_stage` refusal.
- [x] `daemon-pipeline-resume.test.ts` proves named-lane `pipeline_resume` admits the strand only for the requested lane, continues without `reopenFailedPipeline`, and leaves sibling gates and stages unchanged; it fails against the pre-fix refusal.
- [x] `pipeline-execution.test.ts` proves unscoped and explicit-default `resumePipeline` do not dispatch a ready approved-gate pending strand when aggregate derived state is `awaiting-approval`; reachable on mixed fan-out pipelines where unscoped resume is claim-only today.
- [x] `pipeline-execution.test.ts` — `refuses terminal succeeded and rejected pipelines without stage dispatch` stays green.
- [x] `pipeline-execution.test.ts` — `refuses derived running, pending, and interrupted pipelines without stage dispatch` stays green.
- [x] `v2/docs/pipeline-execution.md` documents approved-gate pending-strand admission for unscoped, explicit-default, and named-lane `pipeline resume`, including the `awaiting-approval` mixed fan-out boundary.
- [x] `v2/docs/operator-runbook.md` documents that `pipeline resume` recovers an approved-gate pending strand without reopening a failed stage.
- [x] `v2/docs/v1-behaviors.md` records corrected approved-gate pending-strand resume behavior in the v1 parity baseline.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/pipeline-execution.md` — approved-gate pending-strand resume admission for unscoped, explicit-default, and named-lane paths; `awaiting-approval` mixed fan-out boundary.
- `v2/docs/operator-runbook.md` — `pipeline resume` recovers an approved-gate pending strand.
- `v2/docs/v1-behaviors.md` — corrected pending-strand resume behavior.
