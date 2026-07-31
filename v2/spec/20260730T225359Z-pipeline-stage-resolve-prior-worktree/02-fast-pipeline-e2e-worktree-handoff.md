# Fast pipeline end-to-end worktree handoff

## Problem

Slice-level `pipeline-stage-resolve` tests can pass while the composed daemon path still resolves chained inputs from `PipelineContext.cwd`, because the existing `full-review` end-to-end harness pre-seeds ready-intent and plan files in the operator checkout and overrides `readReadyIntent` / `resolveProjectMatch`.

## Surface

Primary: `v2/src/daemon/pipeline-end-to-end.sandbox-unrunnable.test.ts`. Depends on subspecs 00 and 01.

## Prerequisites

- Subspecs 00–01 landed: chained resolution and real preset-builder success on prior worktrees.
- `fast` pipeline definition (`intent(none) → plan(none) → implement(light)`) is registered (`pipeline-registry.ts`).
- Existing harness uses real `resolveStageWorkflowSteps`, fakes dispatch/wait at the agent boundary, and supports guard inversion (`setInvertResumeFailedRequiresReopenForTest` precedent).

## Decisions

- One new `test:integration:v2` case on the `fast` definition with no approval gates — rules out extending only the `full-review` case that seeds operator-checkout artifacts.
- Admission uses project config `pipeline: { name: "fast" }` (no `terminalAction`); success is all workflow stages `succeeded` and `derivePipelineState(pipeline) === "succeeded"` with no terminal publication — rules out undefined settlement assertions.
- Fixtures place intent ready-intent and plan spec tree only on dispatch-created repo-nested worktrees (`join(repoRoot, ".jarvis-worktrees", branch)`); operator `repoRoot` (`context.cwd`) omits those paths — rules out pre-seeding chained inputs in the primary checkout.
- Repo-nested `.jarvis-worktrees/` is the intentional integration surrogate for production `JARVIS_HOME/worktrees/...` layout; home-dir worktree e2e is deferred — rules out claiming production path layout proof in this harness.
- `fast` case uses production `resolveStage` with real preset builders; remove or narrow `makeResolveStageBuilders` overrides of `readReadyIntent` (must read `join(priorWorktree, readyIntent)`) and `resolveProjectMatch` (must not stub `{ root: cwd }`) for this case — rules out harness overrides that mask inter-stage read-root bugs.
- Dispatch/wait faked only at the agent boundary per `#2352` — rules out stubbing resolution or `readReadyIntent` for the `fast` case.
- Assert intent → plan → implement stages all `succeeded` without merging intermediate PRs to `main` — rules out merge-driven handoff as proof.
- Reuse `setInvertPriorWorktreeRootGuardForTest` from subspec 00 for guard-inversion AC — rules out a second invert hook.
- Deferred to first consumer: additional pipeline definitions beyond `fast` in this harness — pin when a second composed path needs the same worktree-handoff proof.

## Task checklist

- Add a `fast` describe block (or equivalent) to `pipeline-end-to-end.sandbox-unrunnable.test.ts`: admit via `pipeline_start` with `pipeline: { name: "fast" }`, walk intent → plan → implement with artifact files only on stage worktrees.
- Refactor harness so the `fast` case does not override `readReadyIntent` to read from `sandboxRepoRoot` and does not stub `resolveProjectMatch` to `{ root: cwd }`; write ready-intent and plan spec files onto dispatch-created worktrees only.
- Assert stage vector `succeeded,succeeded,succeeded` and `derivePipelineState(pipeline) === "succeeded"` without operator-checkout copies of chained inputs.
- Add guard-inversion subcase using `setInvertPriorWorktreeRootGuardForTest(true)` that fails the `fast` case.

## Acceptance criteria

- [x] `pipeline-end-to-end.sandbox-unrunnable.test.ts` — `fast` case walks `intent(none) → plan(none) → implement(light)` through production `resolveStage`, real `resolveStageWorkflowSteps`, real preset builders, and repo-nested worktree paths with dispatch/wait faked only at the agent boundary; intent ready-intent and plan spec tree are absent from `context.cwd`; all three workflow stages reach `succeeded` and `derivePipelineState(pipeline) === "succeeded"`.
- [x] `pipeline-end-to-end.sandbox-unrunnable.test.ts` — `setInvertPriorWorktreeRootGuardForTest(true)` makes the `fast` case fail.
- [x] `bun run test:integration:v2` exits zero.

## Documentation updates

None — operator semantics landed in subspec 00.
