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
- Fixtures place per-branch ready-intent and plan spec files only on dispatch-created worktrees; operator `context.cwd` omits them — rules out pre-seeding one branch in the primary checkout.
- Dispatch/wait faked only at the agent boundary — rules out stubbing resolution or branch scheduling.
- Deferred to first consumer: additional split shapes beyond N=2 on `fast` — pin when a regression needs them.

## Task checklist

- Add a two-ready-intent `fast` describe block: intent split records two `downstreamInputs`, plan and implement resolve per branch on real worktrees.
- Assert both branches reach workflow `succeeded` (or the authored terminal posture) and `derivePipelineState` reflects full success; add collapse-to-one-branch inversion subcase.
- Run full v2 verification gate from the intent.

## Acceptance criteria

- [ ] `pipeline-end-to-end.sandbox-unrunnable.test.ts` — two-ready-intent split walks intent → plan → implement resolution on real stage worktrees with dispatch/wait faked only at the agent boundary; collapsing fan-out to one branch makes the test fail.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

None — operator semantics landed in subspecs 00–01.
