---
name: pipeline-intent-artifact-ready-intent-file
---

# Intent completion records a concrete ready-intent file for pipeline handoff

## Problem

Git-enabled intent stages land ready-intents on an external worktree and record
`Run.specPath` as the durable **directory** (`v2/spec/ready-intents`). Pipeline
`pipeline-stage-dispatch` copies that value into the stage artifact; plan's
`validateReadyIntent` requires a **file** (`statSync(path).isFile()`), so
intent→plan resolution fails before any agent runs.

## Decisions

- When intent landing produces exactly one ready-intent file, `Run.specPath` and
  the pipeline stage artifact `specPath` name that **file** worktree-relative
  path — rules out passing the durable-dir root through unchanged.
- Intent-stage resume/finalization derives `durableDir` from
  `dirname(entryRun.specPath)` when that path names a file — rules out treating
  the handoff file as `durableDir` or adding a separate handoff field.
- When landing produces more than one ready-intent file, keep `Run.specPath` and
  the stage artifact on the durable ready-intents **directory**; plan resolution
  fails until explicit multi-file routing exists — rules out silently picking one
  file, omitting the artifact, or emitting multiple artifacts in this slice.
- Deferred to first consumer: multi-ready-intent artifact routing when a pipeline
  definition emits more than one file — pin when a pipeline definition needs it.
- Plan spec tree paths are unchanged; plan landing already records the implement
  input directory — rules out reshaping plan publication in this intent.

## Acceptance criteria

- [ ] After a git-enabled intent workflow completes with one landed ready-intent
      file, the entry run's recorded `specPath` is that file's worktree-relative
      path (not the ready-intents directory alone); `intent-output.test.ts` fails
      on baseline directory recording and when the single-file guard is inverted.
- [ ] `intent-output.test.ts` proves multi-file intent landing keeps `specPath` on
      the durable ready-intents directory (no single-file handoff path); inverting
      the single-file guard makes the test fail.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None — operator-facing handoff semantics land in the daemon resolve intent.

## Prerequisites

- Pipeline stage dispatch records `entryRunId` and worktree-relative `specPath` from the completed entry run on stage success.
- Git-enabled intent workflows publish from external worktrees with `landIntentWorkflowOutput` landing staged markdown into the configured durable dir.
