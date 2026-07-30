# Inter-stage worktree resolution

## Problem

`resolveStageWorkflowSteps` passes the prior stage artifact's worktree-relative `specPath` into plan/implement preset builders with `cwd: PipelineContext.cwd`. Intent and plan outputs live on external worktrees until their PRs merge, so chained resolution fails even when the artifact path shape is correct.

## Surface

Primary: `v2/src/daemon/pipeline-stage-resolve.ts`. In-scope support: `pipeline-execution.ts` artifact carry-forward and `resolveStage` wiring; `pipeline-stage-resolve.test.ts` regressions. Preset-builder project match and implement preflight are subspec 01.

## Prerequisites

- Intent landing records a concrete ready-intent file `specPath` on the entry run and stage artifact when exactly one ready-intent file is produced (`workflow-runner.ts` `persistIntentHandoff`, `intent-output.test.ts`).
- `dispatchPipelineStage` records `entryRunId` and worktree-relative `specPath` on stage success (`pipeline-stage-dispatch.ts`).
- `resolveStageWorkflowSteps` maps realizable `(workflow, review)` pairs and skips approval rows when walking back (`pipeline-stage-resolve.ts`, `pipeline-stage-resolve.test.ts`).

## Decisions

- Replace `artifactSpecPaths: Map<string, string>` with `stageArtifacts: Map<string, PipelineStageArtifact>` threaded from `runPipeline` through `resolveStageWorkflowSteps` — rules out parallel spec-path-only maps that drop `entryRunId`.
- `carryForwardArtifact` retains full `PipelineStageArtifact` objects (or equivalent keyed structure), not `extractArtifactSpecPath` strings — rules out resume/replay dropping `entryRunId`.
- Chained plan/implement resolution loads `priorEntryRun` via `store.loadRun(artifact.entryRunId)` and sets preset `cwd` to `priorEntryRun.worktreePath`; `readyIntent` / `specPath` stay worktree-relative — rules out `join(context.cwd, artifact.specPath)` or absolutizing artifact paths in the store.
- First workflow stage keeps `cwd: PipelineContext.cwd` and `PipelineContext.seed` — rules out moving admission `cwd` onto stage worktrees.
- Chained implement calls `resolveBaseRef(priorEntryRun.worktreePath)`; concrete `baseRef` value and implement preflight root are subspec 01 — rules out base-ref lookup on `PipelineContext.cwd` while `cwd` points at the plan worktree.
- Missing prior artifact, missing `entryRunId`, missing entry run, or missing `worktreePath` returns `{ ok: false, error }` — rules out silent fallback to `PipelineContext.cwd`.
- Chained plan resolution rejects directory `specPath` (no `index.md` basename) with a clear resolution error — rules out passing directory paths through to plan builders.
- In-flight pipelines resumed with legacy specPath-only artifact maps are out of scope — pin if resume compatibility is required later.
- Handoff stays artifact-driven between stages; approval gates do not merge or rewrite handoff paths — rules out gate-side merge as the inter-stage read contract.
- Test-only `setInvertPriorWorktreeRootGuardForTest` inverts the prior-worktree `cwd` selection guard — rules out one-way assertions with no invert hook.
- Deferred to first consumer: whether chained intent-after-intent (non-first workflow) needs a distinct read root — pin when a multi-intent pipeline definition ships.

## Task checklist

- Thread `stageArtifacts` from `runPipeline` through `resolveStage` / `resolveStageWorkflowSteps`; add `StateStore` (or injectable `loadRun`) to resolution deps.
- Update all `artifactSpecPaths` call sites: `pipeline-stage-resolve.ts`, `pipeline-execution.ts` (`runPipeline`, `executeWorkflowStage`, `carryForwardArtifact`, `extractArtifactSpecPath` removal or narrowing), `pipeline-execution.test.ts` `resolveStage` mocks, `pipeline-end-to-end.sandbox-unrunnable.test.ts` `productionResolveStage` wiring, and any `workflow-runner.test.ts` pipeline handoff fixtures that pass spec-path-only maps.
- For plan and implement stages, resolve chained inputs from `join(priorEntryRun.worktreePath, artifact.specPath)` via `store.loadRun(artifact.entryRunId)`; leave intent-first-stage paths unchanged.
- Add `pipeline-stage-resolve.test.ts` fixtures with ready-intent / plan spec files only on the prior stage worktree, absent from operator `context.cwd`; use fake builders to assert preset input `cwd` / `readyIntent` / `specPath`.
- Add guard-inversion and missing-artifact negative coverage via `setInvertPriorWorktreeRootGuardForTest` and hard-error cases.
- Update operator docs for inter-stage read root vs admission `cwd`, pipeline vs standalone preset CLI handoff, and that the `fast` integration case (subspec 02) is the inter-stage worktree handoff proof — not the existing `full-review` harness that pre-seeds operator-checkout artifacts.

## Acceptance criteria

- [ ] `pipeline-stage-resolve.test.ts` — with a recorded intent-stage `PipelineStageArtifact` and ready-intent file only on the intent entry-run worktree (absent from `context.cwd`), resolving the plan stage succeeds; captured plan preset input has `cwd` equal to the intent entry-run `worktreePath` and `readyIntent` equal to the artifact worktree-relative `specPath`; `setInvertPriorWorktreeRootGuardForTest(true)` makes the test fail.
- [ ] `pipeline-stage-resolve.test.ts` — with a recorded plan-stage artifact and plan spec tree only on the plan entry-run worktree (absent from `context.cwd`), resolving the implement stage succeeds; captured implement preset input has `cwd` equal to the plan entry-run `worktreePath`, `specPath` equal to the artifact worktree-relative path, and `resolveBaseRef` invoked with the plan entry-run `worktreePath`; `setInvertPriorWorktreeRootGuardForTest(true)` makes the test fail.
- [ ] `pipeline-stage-resolve.test.ts` — missing prior artifact, `entryRunId`, entry run, or `worktreePath` returns `{ ok: false, error }` without falling back to `context.cwd`.
- [ ] `pipeline-stage-resolve.test.ts` — `"approval stages are skipped when walking back to find the preceding workflow artifact"` stays green.
- [ ] `pipeline-stage-resolve.test.ts` — `"first workflow stage builds with PipelineContext.seed as the seed input"` stays green.
- [ ] `pipeline-stage-resolve.test.ts` — `"leave-draft pipeline implement completion skips ready finalization"` stays green.
- [ ] `bun run typecheck` exits zero.

## Documentation updates

- `v2/docs/daemon-host.md` § Pipeline stage resolution — inter-stage chained reads resolve from the prior entry run worktree via `store.loadRun(artifact.entryRunId)`; artifact `specPath` is the next-stage input surface; admission `PipelineContext.cwd` remains the operator checkout anchor for the first workflow stage only; the `full-review` e2e harness pre-seeding operator-checkout artifacts is not the handoff proof (see subspec 02 `fast` case).
- `v2/docs/first-workflow-walkthrough.md` § Configured pipeline — stages hand off via recorded artifacts on stage worktrees; merging intent/plan PRs to `main` between stages is not required; approval gates are continue/stop checkpoints only.
- `v2/docs/workflow-runner.md` — one paragraph: standalone `plan --ready-intent` reads from operator `cwd`; pipeline plan/implement resolution reads chained inputs from the prior stage entry run worktree.
- `v2/docs/v1-behaviors.md` — record updated pipeline inter-stage handoff behavior.
