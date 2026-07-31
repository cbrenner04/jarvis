---
name: pipeline-intent-split-fan-out-execution
---

# Pipeline execution fans out downstream stages per ready-intent branch

## Problem

After a splitting intent, the daemon runs one downstream chain. Additional ready-intents never reach
plan or implement, and branch failures or gates cannot settle independently.

## Decisions

- From the splitting stage forward, each downstream input runs every subsequent stage in definition order on its own branch — rules out picking one input, failing the split, and aborting remaining branches on the first failure.
- `resolveStageWorkflowSteps` after a splitting intent yields one resolution per downstream input, each with its own ready-intent file — rules out resolving only the first input.
- Approval gates block and advance per branch — rules out one shared gate decision for all branches.
- Derived terminal `succeeded` only when every branch reaches terminal success; otherwise the aggregate names failed branches — rules out reporting `succeeded` while a branch failed.
- Cross-branch ordering is unspecified; sequential branch execution is acceptable — rules out blocking on a concurrency design.
- Out of scope: fan-out from a plan stage and fan-in / cross-branch synchronization.

## Acceptance criteria

- [ ] `pipeline-stage-resolve.test.ts` — after a splitting intent artifact with N=2 downstream inputs, resolving the plan stage returns two `ok` resolutions with distinct `readyIntent` files; collapsing to the first input makes the test fail.
- [ ] `pipeline-execution.test.ts` — `pipeline approve` / `pipeline reject` on one branch's gate leaves the other branch's gate `awaiting`; a cross-branch decision leak makes the test fail.
- [ ] `pipeline-execution.test.ts` — with one branch failed and one succeeded, the pipeline settles a non-`succeeded` terminal state naming the failed branch while the succeeding branch still reaches its terminal action; inverting either half makes the test fail.
- [ ] `pipeline-end-to-end.sandbox-unrunnable.test.ts` — two-ready-intent split walks intent → plan → implement resolution on real stage worktrees with dispatch/wait faked only at the agent boundary; collapsing fan-out to one branch makes the test fail.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § Pipeline stage resolution — downstream stages run per branch from the splitting stage forward.
- `v2/docs/v1-behaviors.md` — record pipeline fan-out execution contract.

## Prerequisites

- Durable pipeline stage records, approval gates, and `pipeline list` / `wait` / `approve` / `reject` / `resume` exist.
- Inter-stage handoff resolves chained inputs from the prior entry-run worktree.
- Intent completion records a concrete ready-intent file on the entry run and stage artifact when landing produces exactly one ready-intent file; the ready-intents directory when landing produces more than one.
- Pipeline stage rows are keyed by `(stageId, branchKey)` and stage artifacts may carry multiple downstream inputs.
- Multi-file intent landing records one downstream input per landed ready-intent file on the entry run and stage artifact.
