# Two-ready-intent pipeline e2e

## Problem

Unit tests can pass while the composed daemon path still collapses fan-out to one branch, because fixtures stub resolution or pre-seed a single downstream input.

## Surface

Primary: `v2/src/daemon/pipeline-end-to-end.sandbox-unrunnable.test.ts`. Depends on subspecs 00–01.

## Prerequisites

- Subspecs 00–01 landed: multi-input resolution and per-branch execution.
- Existing harness uses production `resolveStageWorkflowSteps`, fakes dispatch/wait at the agent boundary, and places chained artifacts on repo-nested worktrees (`v2/spec/completed/20260730T225359Z-pipeline-stage-resolve-prior-worktree/02-fast-pipeline-e2e-worktree-handoff.md`).

## Decisions

- One new `test:integration:v2` case on the `fast` definition with a two-ready-intent intent split — rules out extending only single-input e2e coverage.
- Intent landing produces N=2 ready-intent files with distinct `downstreamInputs`; both paths are exercised through plan and implement on separate branches — rules out collapsing fan-out to one branch in the harness.
- Harness asserts per-stage dispatch count of 2 for each downstream workflow stage (plan, implement); update or replace single-branch helpers (`fastStageStatusVector`, `dispatchCounts`, row lookup by `stageId` only) for branch-aware expectations — rules out a collapse-to-one-branch regression passing on final success alone.
- Fixtures place per-branch ready-intent and plan spec files only on dispatch-created worktrees; operator `context.cwd` omits them — rules out pre-seeding one branch in the primary checkout.
- Dispatch/wait faked only at the agent boundary — rules out stubbing resolution or branch scheduling.
- Deferred to first consumer: additional split shapes beyond N=2 on `fast` — pin when a regression needs them.

## Task checklist

- Add a two-ready-intent `fast` describe block: intent split records two `downstreamInputs`, plan and implement resolve per branch on real worktrees.
- Assert dispatch count 2 per downstream workflow stage, both branches reach workflow `succeeded`, and `derivePipelineState` reflects full success; add collapse-to-one-branch inversion subcase.
- Update branch-aware harness helpers so single-branch assumptions fail under two-branch fixtures.
- Run full v2 verification gate from the intent.

## Acceptance criteria

- [x] `pipeline-end-to-end.sandbox-unrunnable.test.ts` — two-ready-intent split walks intent → plan → implement on real stage worktrees with dispatch/wait faked only at the agent boundary; each downstream workflow stage dispatches twice; collapsing fan-out to one branch makes the test fail.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

None — operator semantics landed in subspecs 00–01.
