# 00 - Record ready-intent file handoff path

## Problem

Git-enabled intent landing records `Run.specPath` as the durable ready-intents **directory**. Pipeline `pipeline-stage-dispatch` copies that into the stage artifact; plan `validateReadyIntent` requires a **file**, so intent→plan resolution fails before any agent runs.

## Decisions

- Pipeline handoff authority is the step-0 write/entry run row (`stepId: "intent"`); handoff `specPath` values remain project-root-relative as today's durable-dir paths are; plan-resolution `cwd` behavior is unchanged.
- "Exactly one landed file" means markdown files produced by **this** landing invocation, not total files already present under the durable ready-intents directory.
- When this landing produces exactly one ready-intent file, `landIntentWorkflowOutput` returns that file's worktree-relative path as `specPath` (including the idempotent re-land early-return path); the authoritative entry run row and pipeline stage artifact record the same path — rules out passing the durable-dir root through unchanged.
- When this landing produces more than one ready-intent file, `specPath` stays the durable ready-intents directory; plan resolution fails until explicit multi-file routing exists — rules out silently picking one file, omitting the artifact, or emitting multiple artifacts in this slice.
- After intent landing completes (including review-last / `intent-reviewed` completion, not only zero-review or direct landing), the step-0 entry/write run row's `specPath` is updated to the handoff value; `pipeline-stage-dispatch` reads that persisted value unchanged — rules out duplicating handoff logic in the daemon dispatch seam.
- Intent-stage resume/finalization derives `durableDir` from `dirname(writeRun.specPath)` when that path names a file; `landing.output.durableDir`, commit scope, and publish scope remain the configured durable directory — rules out treating the handoff file as `durableDir` or adding a separate handoff field.
- When handoff `specPath` becomes a file, publication title/commit `Spec:` metadata may use the file basename rather than the durable directory — intentional behavior change, not an implementation surprise.
- Plan spec-tree landing and implement input directories are unchanged — rules out reshaping plan publication in this slice.
- Deferred to first consumer: multi-ready-intent artifact routing when a pipeline definition emits more than one file — pin when a pipeline definition needs it.

## Prerequisites

- Pipeline stage dispatch records `entryRunId` and worktree-relative `specPath` from the completed entry run on stage success.
- Git-enabled intent workflows publish from external worktrees with `landIntentWorkflowOutput` landing staged markdown into the configured durable dir.

## Task checklist

- [ ] `landIntentWorkflowOutput` (including idempotent re-land early-return): single file from this landing → file `specPath`; multiple files → durable-dir `specPath`.
- [ ] Review-last / `intent-reviewed` completion path: capture landed handoff `specPath` and persist it on the step-0 entry/write run row after landing.
- [ ] Post-landing persistence seam: update the authoritative step-0 entry/write run row (`stepId: "intent"`) `specPath` to the handoff value (file or directory per single/multi-file rules).
- [ ] `resolveIntentFinalizationResumeContext` and intent resume commit/publish consumers: derive `durableDir` from `dirname(writeRun.specPath)` when stored path is a file; keep `landing.output.durableDir` and commit/publish scope on the configured durable directory.
- [ ] Extend `intent-output.test.ts`, `workflow-runner.test.ts`, and `publication-landing.test.ts` per acceptance criteria.
- [ ] Correct `v2/docs/workflow-runner.md` and record new handoff semantics in `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] `intent-output.test.ts` — single-file landing records `specPath` as the landed file's worktree-relative path (not the durable directory alone); fails on baseline directory recording and when the single-file guard is inverted.
- [x] `intent-output.test.ts` — multi-file landing keeps `specPath` on the durable ready-intents directory; inverting the single-file guard makes the test fail.
- [x] `intent-output.test.ts` — idempotent re-land early-return applies the same single-file → file / multi-file → directory rule; inverting the single-file guard makes the test fail.
- [x] `workflow-runner.test.ts` — review-last intent completion (`review: "light"` / `intent-reviewed`, not only `reviewPasses: 0`) records the file handoff path on the step-0 entry run; fails on baseline directory recording and when the single-file handoff guard is inverted.
- [x] `workflow-runner.test.ts` — `resolveIntentFinalizationResumeContext` derives `durableDir` from `dirname(writeRun.specPath)` when the write sibling stores a file handoff path; `landing.output.durableDir` and commit/publish scope stay on the configured durable directory; inverting the file-vs-directory guard makes the test fail.
- [x] Pipeline resolution — after single-file intent completion, the stage artifact's `specPath` names a file and plan-stage resolution accepts it (`validateReadyIntent` passes or `resolvePlanStage` succeeds); fails on baseline directory handoff.
- [x] `publication-landing.test.ts` — single-file handoff `specPath` shape is reflected in publication landing expectations; fails on baseline directory recording.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- [x] `v2/docs/workflow-runner.md` — correct intent publication `specPath` semantics (file handoff when single-file landing, not durable directory alone).
- [x] `v2/docs/v1-behaviors.md` — record new intent→plan handoff `specPath` behavior.
