---
name: pipeline-stage-review-feedback-launch
---

# Daemon launches review-feedback for a pipeline stage without resuming it

## Problem

Pipeline operators must leave pipeline control and hand-assemble `jarvis run workflow review-feedback` with `--pipeline`, `--stage`, and `--branch-key` to address review on a stage PR.

## Decisions

- A dedicated daemon launch path (not `pipeline_resume`) accepts `pipelineId`, `stageId`, and optional `branchKey`, resolves the stage's completed intent/plan/implement lane branch, and runs the same review-feedback admission and workflow start as the standalone preset.
- Every admission refusal (in flight, no review, merged/closed PR, wrong kind, capture failure, unmatched stage) surfaces verbatim with the standalone codes.
- Pipeline state, stage rows, and gates are unchanged; the admitted run is linked to the pipeline and stage for display only.
- The review-feedback preset remains standalone-only; this is re-entry on an existing stage, not a pipeline definition change.

## Acceptance criteria

- [ ] A daemon handler test with a fake store and fake `gh` proves completed intent, plan, and implement stages with an open reviewed PR each admit on that stage's branch; an unknown stage, an unfinished stage, and a no-review PR each refuse by name; pipeline and stage rows are byte-identical before and after; it fails against the pre-fix code.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — `pipeline resume --address-review` flag semantics and that pipeline state is unchanged.

## Prerequisites

- `jarvis run workflow review-feedback` admits only a completed intent, plan, or implement lane (bare or pipeline-disambiguated), requires an open PR with at least one review, runs the capture prelude, and dispatches the write preset that republishes to the same PR.
