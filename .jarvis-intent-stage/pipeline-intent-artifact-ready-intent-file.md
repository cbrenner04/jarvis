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
- When landing produces more than one ready-intent file, do not invent routing —
  rules out silently picking a file or emitting multiple artifacts in this slice.
- Deferred to first consumer: multi-ready-intent artifact routing when a pipeline
  definition emits more than one file — pin when a pipeline definition needs it.
- Plan spec tree paths are unchanged; plan landing already records the implement
  input directory — rules out reshaping plan publication in this intent.

## Acceptance criteria

- [ ] After a git-enabled intent workflow completes with one landed ready-intent
      file, the entry run's recorded `specPath` is that file's worktree-relative
      path (not the ready-intents directory alone); a regression test fails on
      baseline directory recording and passes after the change.
- [ ] `intent-output.test.ts` (or equivalent) proves multi-file intent landing
      does not record a single-file handoff path without an explicit routing rule;
      inverting the single-file guard makes the test fail.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None — operator-facing handoff semantics land in the daemon resolve intent.

## Prerequisites

- Pipeline stage dispatch records `entryRunId` and worktree-relative `specPath` from the completed entry run on stage success.
- Git-enabled intent workflows publish from external worktrees with `landIntentWorkflowOutput` landing staged markdown into the configured durable dir.
