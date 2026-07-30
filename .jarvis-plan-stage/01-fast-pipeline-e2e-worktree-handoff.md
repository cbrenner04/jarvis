# Fast pipeline end-to-end worktree handoff

## Problem

Slice-level `pipeline-stage-resolve` tests can pass while the composed daemon path still resolves chained inputs from `PipelineContext.cwd`, because the existing `full-review` end-to-end harness pre-seeds ready-intent and plan files in the operator checkout.

## Surface

Primary: `v2/src/daemon/pipeline-end-to-end.sandbox-unrunnable.test.ts`. Depends on subspec 00.

## Prerequisites

- Subspec 00 landed: chained plan/implement resolution reads from the prior entry run worktree.
- `fast` pipeline definition (`intent(none) → plan(none) → implement(light)`) is registered (`pipeline-registry.ts`).
- Existing `pipeline-end-to-end.sandbox-unrunnable.test.ts` harness uses real `resolveStageWorkflowSteps`, fakes dispatch/wait at the agent boundary, and supports guard inversion (`setInvertResumeFailedRequiresReopenForTest` precedent).

## Decisions

- One new `test:integration:v2` case on the `fast` definition with no approval gates — rules out extending only the `full-review` case that seeds operator-checkout artifacts.
- Fixtures place intent ready-intent and plan spec tree only on dispatch-created external worktrees; operator `repoRoot` (`context.cwd`) omits those paths — rules out pre-seeding chained inputs in the primary checkout.
- Case uses production handler `resolveStage` (real `resolveStageWorkflowSteps` + preset builders); dispatch/wait faked only at the agent boundary per `#2352` — rules out stubbing resolution or `readReadyIntent`.
- Assert intent → plan → implement stages all `succeeded` without merging intermediate PRs to `main` — rules out merge-driven handoff as proof.
- Reuse `setInvertPriorWorktreeRootGuardForTest` from subspec 00 for guard-inversion AC — rules out a second invert hook.
- Deferred to first consumer: additional pipeline definitions beyond `fast` in this harness — pin when a second composed path needs the same worktree-handoff proof.

## Task checklist

- Add a `fast` pipeline case to `pipeline-end-to-end.sandbox-unrunnable.test.ts`: admit via `pipeline_start`, walk intent → plan → implement with artifact files only on stage worktrees.
- Assert all three workflow stages reach `succeeded` and derived pipeline state progresses to terminal settlement (or running-through-settlement per harness pattern) without operator-checkout copies of chained inputs.
- Add guard-inversion subcase using `setInvertPriorWorktreeRootGuardForTest(true)` that fails the named case.

## Acceptance criteria

- [ ] `pipeline-end-to-end.sandbox-unrunnable.test.ts` — `fast` case fails against baseline, then walks `intent(none) → plan(none) → implement(light)` through real `resolveStageWorkflowSteps` and real worktree paths with dispatch/wait faked only at the agent boundary; intent ready-intent and plan spec tree are absent from `context.cwd`; all three workflow stages `succeeded`.
- [ ] `pipeline-end-to-end.sandbox-unrunnable.test.ts` — inverting `setInvertPriorWorktreeRootGuardForTest` makes the `fast` case fail.
- [ ] `bun run test:integration:v2` exits zero.

## Documentation updates

None — operator semantics landed in subspec 00.
