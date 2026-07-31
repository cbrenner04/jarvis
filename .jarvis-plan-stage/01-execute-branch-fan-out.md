# Execute branch fan-out

## Problem

`runPipeline` walks one `default` row per authored stage. After a splitting intent, additional ready-intents never reach plan or implement, approval gates cannot settle per branch, and one branch failure aborts the rest.

## Surface

Primary: `v2/src/daemon/pipeline-execution.ts`. In-scope: `pipeline-stage-dispatch.ts` artifact carry-forward, `pipeline-execution.test.ts`, branch-scoped `pipeline_approve` / `pipeline_reject` resolution in `pipeline-execution.ts` and `daemon.ts`. Depends on subspec 00.

## Prerequisites

- Subspec 00 landed: chained resolution fans out per `downstreamInputs` entry.
- Pipeline stage rows are keyed by `(stageId, branchKey)` and `createPipelineStageBranch` admits additional rows (`state-store.ts`).
- Durable approval gates and `pipeline_approve` / `pipeline_reject` RPC handlers exist (`v2/spec/completed/20260730T081814Z-pipeline-daemon-approval-and-stage-resume/`).

## Decisions

- From the splitting intent stage forward, each downstream input runs every subsequent authored stage in definition order on its own `branchKey` — rules out picking one input, failing the split, or aborting remaining branches on the first failure.
- `branchKey` is the ready-intent file basename without `.md` — rules out opaque or ordinal-only keys with no file correlation.
- `pipeline_approve` and `pipeline_reject` resolve the approval row by `(pipelineId, stageId, branchKey)` — rules out one shared gate decision for all branches.
- One branch's failure or rejection does not skip or fail sibling branches' remaining stages — rules out suffix `skipRemainingStages` spanning branches.
- Derived terminal `succeeded` only when every fan-out branch reaches terminal success; otherwise aggregate state names failed/rejected branches — rules out reporting `succeeded` while a branch failed.
- Cross-branch ordering is unspecified; sequential branch execution is acceptable — rules out blocking on a concurrency design.
- Out of scope: fan-out from a plan stage and fan-in / cross-branch synchronization — rules out plan-split or merge gates in this slice.
- Deferred to first consumer: fate of pre-admitted `default` rows for downstream stages after fan-out — pin when observation projection must hide or reconcile them (`pipeline-branch-operator-cli`).

## Task checklist

- After splitting intent succeeds, admit and execute per-input branch rows for downstream workflow and approval stages; wire subspec 00 multi-resolution dispatch per branch.
- Scope `findStageRecord`, `advanceWorkflowStage`, `advanceApprovalStage`, and approval RPC row lookup by `branchKey`.
- Extend `derivePipelineState` (and terminal settlement) to aggregate across fan-out branches.
- Add `pipeline-execution.test.ts` two-branch fixtures: per-branch gate isolation, mixed success/failure terminal derivation, guard inversions.
- Record fan-out execution contract in `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` — `pipeline approve` / `pipeline reject` on one branch's gate leaves the other branch's gate `awaiting`; a cross-branch decision leak makes the test fail.
- [ ] `pipeline-execution.test.ts` — with one branch failed and one succeeded, the pipeline settles a non-`succeeded` terminal state naming the failed branch while the succeeding branch still reaches its terminal action; inverting either half makes the test fail.
- [ ] `pipeline-execution.test.ts` — `"continues past an approved gate and dispatches the next workflow stage"` stays green for single-branch (`default`) pipelines.
- [ ] `bun run typecheck` exits zero.
- [ ] `bun run test:v2` exits zero.

## Documentation updates

- `v2/docs/daemon-host.md` § Pipeline stage resolution — downstream stages run per branch from the splitting stage forward; approval decisions and terminal settlement are branch-scoped.
- `v2/docs/v1-behaviors.md` — record pipeline fan-out execution contract.
