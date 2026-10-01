# Daemon RPC `pipeline_stage_review_feedback_launch`

## Problem

Operators must hand-assemble `jarvis run workflow review-feedback` with pipeline disambigators to address review on a stage PR. The daemon should admit the same workflow from `(pipelineId, stageId[, branchKey])` without `pipeline_resume` or any pipeline/stage mutation.

## Prerequisites

- Subspec `00-pipeline-stage-review-feedback-lane-resolution.md`.
- Landed `prepareReviewFeedbackWorkflowAdmission`, capture prelude, and review-feedback dispatch (`20260930T051311Z-review-feedback-lane-admission`, `20260930T152035Z-review-feedback-write-run`).

## Decisions

- RPC method `pipeline_stage_review_feedback_launch` with params `{ pipelineId, stageId, branchKey? }` (camelCase strings; omit `branchKey` only when a single stage row exists) — rules out overloading `pipeline_resume` or `start` with ad-hoc params.
- Handler flow: validate params → resolve lane via subspec `00` → `runReviewFeedbackAdmissionPrelude` → `prepareWorkflowStart` for `review-feedback` → `admitWorkflowStart` / `handleWorkflowStart` on the prepared steps — rules out a second admission implementation or CLI-only prelude.
- Every admission refusal returns the same stable `review_feedback_*` / `review_feedback_write_not_available` codes and messages as standalone `jarvis run workflow review-feedback` — rules out daemon-specific refusal names.
- Success admits a detached workflow run; durable `pipelines` / `pipeline_stages` rows and approval gates are read-only (byte-identical before/after on refuse and admit) — rules out stage settlement, reopen, resume, or `workflowInvocationId` replacement.
- Admitted runs carry pipeline stage provenance on the workflow snapshot (`reviewFeedbackLane` / lane target provenance) for monitor attribution only; no new durable pipeline↔run foreign key — rules out treating review-feedback as stage dispatch.
- Register the handler on the daemon public RPC surface alongside other `pipeline_*` methods; wire stable routing if required by existing pipeline decision ownership — rules out a CLI-only entrypoint.
- Deferred to first consumer: CLI/TUI command that calls this RPC — pin when `pipeline-stage-addresses-review-feedback` or equivalent lands.

## Tasks

- Implement `pipeline_stage_review_feedback_launch` in pipeline/daemon handlers; export wire types if needed.
- Reuse shared review-feedback admission preparation from subspec `00` inside the handler.
- Add `daemon-pipeline-stage-review-feedback-launch.test.ts` with injectable store and fake `gh`: admit intent/plan/implement succeeded stages with open reviewed PRs; refuse unknown stage, unfinished stage, and no-review PR by refusal code; assert pipeline and stage store snapshots unchanged across refuse and admit paths.
- Document RPC params, refusal parity, and unchanged pipeline state in `v2/docs/pipeline-execution.md`.

## Acceptance criteria

- [x] `daemon-pipeline-stage-review-feedback-launch.test.ts` proves completed intent, plan, and implement stages with an open reviewed PR each admit on that stage's branch; an unknown stage, an unfinished stage, and a no-review PR each refuse by name; pipeline and stage rows are byte-identical before and after; it fails against the pre-fix code.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — `pipeline_stage_review_feedback_launch` request params, admission refusals (same codes as standalone review-feedback), and that pipeline/stage state is unchanged.
