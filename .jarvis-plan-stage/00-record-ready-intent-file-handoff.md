# 00 - Record ready-intent file handoff path

## Problem

Git-enabled intent landing records `Run.specPath` as the durable ready-intents **directory**. Pipeline `pipeline-stage-dispatch` copies that into the stage artifact; plan `validateReadyIntent` requires a **file**, so intent→plan resolution fails before any agent runs.

## Decisions

- When landing produces exactly one ready-intent file, `landIntentWorkflowOutput` returns that file's worktree-relative path as `specPath`; the entry/write run row and pipeline stage artifact record the same path — rules out passing the durable-dir root through unchanged.
- When landing produces more than one ready-intent file, `specPath` stays the durable ready-intents directory; plan resolution fails until explicit multi-file routing exists — rules out silently picking one file, omitting the artifact, or emitting multiple artifacts in this slice.
- Intent-stage resume/finalization derives `durableDir` from `dirname(writeRun.specPath)` when that path names a file; `landing.output.durableDir` and commit scope stay on the configured durable directory — rules out treating the handoff file as `durableDir` or adding a separate handoff field.
- `pipeline-stage-dispatch` is unchanged; it already copies `entryRun.specPath` on stage success — rules out duplicating handoff logic in the daemon dispatch seam.
- Plan spec-tree landing and implement input directories are unchanged — rules out reshaping plan publication in this slice.
- Deferred to first consumer: multi-ready-intent artifact routing when a pipeline definition emits more than one file — pin when a pipeline definition needs it.

## Task checklist

- [ ] `landIntentWorkflowOutput` (including idempotent re-land): single landed file → file `specPath`; multiple files → durable-dir `specPath`.
- [ ] Persist post-landing handoff `specPath` on the intent write/entry run row after intent landing completes.
- [ ] `resolveIntentFinalizationResumeContext` (and intent resume commit/publish paths that consume `writeRun.specPath` as `durableDir`): derive durable directory when the stored path is a file.
- [ ] Extend `intent-output.test.ts` and `workflow-runner.test.ts` per acceptance criteria.

## Acceptance criteria

- [ ] `intent-output.test.ts` — single-file landing records `specPath` as the landed file's worktree-relative path (not the durable directory alone); fails on baseline directory recording and when the single-file guard is inverted.
- [ ] `intent-output.test.ts` — multi-file landing keeps `specPath` on the durable ready-intents directory; inverting the single-file guard makes the test fail.
- [ ] `workflow-runner.test.ts` — after a git-enabled intent workflow completes with one landed ready-intent file, the entry run's recorded `specPath` is that file path; fails on baseline and when the single-file handoff guard is inverted.
- [ ] `workflow-runner.test.ts` — `resolveIntentFinalizationResumeContext` derives `durableDir` from `dirname(writeRun.specPath)` when the write sibling stores a file handoff path; inverting the file-vs-directory guard makes the test fail.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None — operator-facing handoff semantics land in the daemon resolve intent.
