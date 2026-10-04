# Resolve a completed intent, plan, or implement lane for review-feedback

## Problem

Review-feedback admission must bind to exactly one finished intent, plan, or implement lane on a named branch — bare workflow invocation or pipeline stage — before any PR or capture work runs.

## Decisions

- Preset name for the downstream CLI and eligibility table is `review-feedback` (already standalone-only in `PIPELINE_ELIGIBILITY`; not a pipeline stage `workflow` value).
- Eligible source workflows are base lanes only: `intent`, `plan`, and `implement` (pipeline stage `workflow` values and matching bare preset names). Reviewed preset names (`intent-reviewed`, `plan-reviewed`, `plan-reviewed-light`) and any other registered preset are refused as `review_feedback_lane_not_eligible` — rules out treating debate-only or review-feedback rows as admission targets.
- `ReviewFeedbackLaneKind` is exactly `"intent" | "plan" | "implement"` on `ReviewFeedbackLaneTarget.laneKind` — rules out ad hoc strings in subspec `02`.
- Bare lane row: the durable run on `(project, branch)` whose `stepId` equals `workflowSnapshot.steps[0].stepId` for its invocation (entry run). Bare `laneKind` maps from that row's `workflowSnapshot.steps[0]`: `implement` when `role === "implement"`; `intent` when `promptId === "intent.prompt.split"`; `plan` when `promptId === "plan.prompt.draft"`; any other first-step pin → `review_feedback_lane_not_eligible` — rules out inferring kind from branch name or from reviewed-only snapshot shapes that do not match base preset pins.
- Pipeline `laneKind` is the succeeded stage definition's `workflow` field when it is a base name; `review` posture does not change kind — rules out reading `laneKind` from the entry snapshot when the stage definition already names the base workflow.
- **Completed** means `resolveWorkflowRunRollup` over the entry run, its `workflowSnapshot`, and `findRunsByInvocationId` siblings reports terminal `completed`, and `resolvePrEvidenceAcrossInvocation(entryRun, siblingRuns)` returns a pair (same ordering as pipeline stage settlement: prefer entry, then first sibling with both `prNumber` and `prUrl`) — rules out treating a lone `prNumber` without `prUrl` as published or ignoring publication-tail rows.
- Resolved `prNumber` / `prUrl` on `ReviewFeedbackLaneTarget` come from that `resolvePrEvidenceAcrossInvocation` result only; when it returns `undefined`, bare resolution yields `review_feedback_lane_unmatched` (not `in_flight`) — rules out admitting lanes that rolled up completed without confirmed publication evidence.
- **Completed** also requires no non-terminal run row on the same `(project, branch)` worktree ownership key — rules out admitting lanes still in flight or never published.
- Bare targeting: `jarvis run workflow review-feedback --branch <lane-branch>` with no pipeline flags resolves the unique eligible completed invocation on that branch for the active project (`cwd` registry match). Zero matches → `review_feedback_lane_unmatched`; more than one → `review_feedback_lane_ambiguous` — rules out silently picking the newest row without disambiguation.
- Pipeline targeting: `--pipeline <id>`, `--stage <stage-id>`, and `--branch <lane-branch>` are required together. Omission of any → `review_feedback_lane_unmatched` with a message naming the missing flag — rules out inferring pipeline context from branch alone.
- Fan-out: when the named stage has multiple `branchKey` rows for the same `stageId`, `--branch-key <key>` is required; when only the default key exists, `--branch-key` may be omitted — rules out matching the wrong fan-out sibling.
- Pipeline match uses the stage row whose `workflowInvocationId` points at a completed entry run on `--branch` with an eligible `workflow` kind; stage status must be `succeeded` — rules out admitting failed, running, or skipped stages.
- Resolution returns `ReviewFeedbackLaneTarget`: `laneKind`, `project`, `branch`, `worktreePath` from the matched entry run row, `prNumber` / `prUrl` from `resolvePrEvidenceAcrossInvocation`, and provenance (`bare` vs `pipeline` with ids) for downstream capture and step stamping — rules out re-querying persistence in the capture and CLI layers.
- Refusal codes are stable snake strings surfaced verbatim to operators: `review_feedback_lane_in_flight`, `review_feedback_lane_unmatched`, `review_feedback_lane_ambiguous`, `review_feedback_lane_not_eligible` — rules out ad hoc prose-only errors without a machine code.
- Implementation lives in a dedicated execution module (e.g. `review-feedback-lane-resolution.ts`) with injectable `StateStore` and pipeline listing; no `gh` calls in this subspec — rules out coupling lane resolution to GitHub IO.

## Tasks

- Add pure resolution API + refusal result type for bare and pipeline-shaped requests.
- Implement bare-branch disambiguation and pipeline stage + `branchKey` matching against `listPipelines` / `loadPipeline` and `findRunsByInvocationId`.
- Add unit tests with in-memory store fixtures for completed intent, plan, and implement bare lanes, a succeeded pipeline stage with required flags, and each named refusal (in-flight, unmatched, ambiguous, not eligible).

## Acceptance criteria

- [x] `review-feedback-lane-resolution.test.ts` test `resolves a completed bare intent lane by branch` fails against the pre-fix code (no resolution module) and passes after implementation.
- [x] The same file's tests `resolves a completed bare plan lane by branch` and `resolves a completed bare implement lane by branch` pass.
- [x] Test `resolves a succeeded pipeline stage with pipeline stage and branch-key flags` passes.
- [x] Tests `refuses in-flight lane`, `refuses unmatched branch`, `refuses ambiguous bare branch`, and `refuses non intent-plan-implement workflow kind` each assert the documented refusal code and fail against the pre-fix code.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

- None (operator-facing refusal catalog lands in subspec `02`).
