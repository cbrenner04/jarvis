---
name: pipeline-stage-resolve-prior-worktree
---

# Pipeline inter-stage resolution reads chained paths from the prior stage worktree

## Problem

`pipeline-stage-resolve` passes the prior stage artifact's worktree-relative
`specPath` into plan/implement preset builders with `cwd: PipelineContext.cwd`
(the operator's primary checkout at pipeline start). Intent and plan outputs live
on external worktrees until their PRs merge, so chained resolution fails even when
the artifact path shape is correct.

## Decisions

- Inter-stage chained reads resolve `join(priorEntryRun.worktreePath,
  artifact.specPath)` via `store.loadRun(artifact.entryRunId)` — rules out
  re-reading from `PipelineContext.cwd` or copying published files into the
  operator checkout.
- `PipelineContext.cwd` stays the project/admission anchor for registry lookup and
  first-stage seed input; only later workflow stages switch read root — rules out
  moving admission `cwd` onto stage worktrees.
- Handoff stays artifact-driven, not merge-driven — rules out documenting merge at
  each approval gate as the only supported operator path.
- `full-review` approval gates remain continue/stop checkpoints only — rules out
  gate handlers performing merges or mutating handoff paths.
- Integration proof uses real `resolveStageWorkflowSteps` and real worktree paths;
  agent dispatch/wait faking matches the `#2352` boundary — rules out
  pre-seeding ready-intent/plan files in the operator checkout or stubbing
  resolution.

## Acceptance criteria

- [ ] After a git-enabled intent stage succeeds in a pipeline, resolving the plan
      stage succeeds without the ready-intent file present in the operator's
      primary checkout; a `pipeline-stage-resolve.test.ts` regression proves plan
      reads `join(priorWorktree, artifact.specPath)` rather than
      `join(context.cwd, artifact.specPath)` and fails when the worktree-root
      guard is inverted.
- [ ] After a git-enabled plan stage succeeds, resolving the implement stage
      succeeds using the plan entry run worktree and plan spec tree path without
      the plan PR on `main`; inverting the worktree-root guard makes that test
      fail.
- [ ] `pipeline-end-to-end.sandbox-unrunnable.test.ts` walks `fast`
      (`intent(none) → plan(none) → implement(light)`) intent → plan → implement
      resolution using real `resolveStageWorkflowSteps` and real worktree paths
      with dispatch/wait faked only at the agent boundary; inverting the
      worktree-root guard makes the test fail.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § Pipeline stage resolution — inter-stage paths
  resolve from the prior entry run worktree; artifact `specPath` is the
  next-stage input surface.
- `v2/docs/first-workflow-walkthrough.md` § Configured pipeline — remove any
  implication that merging intent/plan PRs to `main` is required between stages;
  note approval gates are continue/stop only.
- `v2/docs/workflow-runner.md` — one paragraph on pipeline handoff vs standalone
  preset CLI (standalone `plan --ready-intent` still reads from cwd; pipeline
  reads from prior worktree).
- `v2/docs/v1-behaviors.md` — record updated pipeline inter-stage handoff
  behavior.

## Prerequisites

- Intent completion records a concrete ready-intent file path on the entry run and pipeline stage artifact when landing produces exactly one ready-intent file.
- Pipeline stage dispatch records `entryRunId` and worktree-relative `specPath` from the completed entry run on stage success.
- `pipeline-stage-resolve` maps realizable workflow and review pairs to preset builders and walks prior workflow stages skipping approval rows.
- Git-enabled intent and plan stages publish from external worktrees.
