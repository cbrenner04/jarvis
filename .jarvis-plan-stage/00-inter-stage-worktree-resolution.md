# Inter-stage worktree resolution

## Problem

`resolveStageWorkflowSteps` passes the prior stage artifact's worktree-relative `specPath` into plan/implement preset builders with `cwd: PipelineContext.cwd`. Git-enabled intent and plan outputs live on external worktrees until their PRs merge, so chained resolution fails even when the artifact path shape is correct.

## Surface

Primary: `v2/src/daemon/pipeline-stage-resolve.ts`. In-scope support: `pipeline-execution.ts` artifact carry-forward into resolution; `pipeline-stage-resolve.test.ts` regressions.

## Prerequisites

- Intent landing records a concrete ready-intent file `specPath` on the entry run and stage artifact when exactly one ready-intent file is produced (`workflow-runner.ts` `persistIntentHandoff`, `intent-output.test.ts`).
- `dispatchPipelineStage` records `entryRunId` and worktree-relative `specPath` on stage success (`pipeline-stage-dispatch.ts`).
- `resolveStageWorkflowSteps` maps realizable `(workflow, review)` pairs and skips approval rows when walking back (`pipeline-stage-resolve.ts`, `pipeline-stage-resolve.test.ts`).
- Git-enabled intent and plan presets materialize external worktrees (`publication-workflow-steps.ts`, `external-worktree.ts`).

## Decisions

- Replace `artifactSpecPaths: Map<string, string>` with `stageArtifacts: Map<string, PipelineStageArtifact>` threaded from `runPipeline` through `resolveStageWorkflowSteps` — rules out parallel spec-path-only maps that drop `entryRunId`.
- Chained plan/implement resolution loads `priorEntryRun` via `store.loadRun(artifact.entryRunId)` and sets preset `cwd` to `priorEntryRun.worktreePath`; `readyIntent` / `specPath` stay worktree-relative — rules out `join(context.cwd, artifact.specPath)` or absolutizing artifact paths in the store.
- First workflow stage keeps `cwd: PipelineContext.cwd` and `PipelineContext.seed` — rules out moving admission `cwd` onto stage worktrees.
- Chained implement `resolveBaseRef` runs against the prior entry run worktree, not `PipelineContext.cwd` — rules out base-ref lookup on the operator checkout while `cwd` points at the plan worktree.
- Missing prior artifact, missing `entryRunId`, missing entry run, or missing `worktreePath` returns `{ ok: false, error }` — rules out silent fallback to `PipelineContext.cwd`.
- Handoff stays artifact-driven between stages; approval gates do not merge or rewrite handoff paths — rules out gate-side merge as the inter-stage read contract.
- Test-only `setInvertPriorWorktreeRootGuardForTest` inverts the prior-worktree `cwd` selection guard — rules out one-way assertions with no invert hook.
- Deferred to first consumer: whether chained intent-after-intent (non-first workflow) needs a distinct read root — pin when a multi-intent pipeline definition ships.

## Task checklist

- Thread `stageArtifacts` (full `PipelineStageArtifact` per succeeded workflow stage) from `pipeline-execution.ts` into `resolveStageWorkflowSteps`; add `StateStore` (or injectable `loadRun`) to resolution deps.
- For plan and implement stages, resolve chained inputs from `join(priorEntryRun.worktreePath, artifact.specPath)` via `store.loadRun(artifact.entryRunId)`; leave intent-first-stage and non-chained paths unchanged.
- Add `pipeline-stage-resolve.test.ts` git-worktree fixtures: ready-intent / plan spec tree exist only on the prior stage worktree, absent from operator `context.cwd`.
- Add guard-inversion coverage via `setInvertPriorWorktreeRootGuardForTest`.
- Update operator docs for inter-stage read root vs admission `cwd` and pipeline vs standalone preset CLI handoff.

## Acceptance criteria

- [ ] `pipeline-stage-resolve.test.ts` — after a git-enabled intent stage artifact is recorded, resolving the plan stage succeeds without the ready-intent file in `context.cwd`; the test proves plan preset input uses `cwd` equal to the intent entry run worktree and `readyIntent` equal to the artifact worktree-relative `specPath`; it fails against baseline and fails when `setInvertPriorWorktreeRootGuardForTest(true)`.
- [ ] `pipeline-stage-resolve.test.ts` — after a git-enabled plan stage artifact is recorded, resolving the implement stage succeeds with plan spec tree only on the plan entry run worktree (absent from `context.cwd` and from `main`); implement preset input uses `cwd` equal to the plan entry run worktree and `specPath` equal to the artifact worktree-relative path; it fails against baseline and fails when `setInvertPriorWorktreeRootGuardForTest(true)`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § Pipeline stage resolution — inter-stage chained reads resolve from the prior entry run worktree via `store.loadRun(artifact.entryRunId)`; artifact `specPath` is the next-stage input surface; admission `PipelineContext.cwd` remains the operator checkout anchor for the first workflow stage only.
- `v2/docs/first-workflow-walkthrough.md` § Configured pipeline — stages hand off via recorded artifacts on stage worktrees; merging intent/plan PRs to `main` between stages is not required; approval gates are continue/stop checkpoints only.
- `v2/docs/workflow-runner.md` — one paragraph: standalone `plan --ready-intent` reads from operator `cwd`; pipeline plan/implement resolution reads chained inputs from the prior stage entry run worktree.
- `v2/docs/v1-behaviors.md` — record updated pipeline inter-stage handoff behavior.
