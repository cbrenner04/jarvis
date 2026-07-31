# Execute branch fan-out

## Problem

`runPipeline` walks one `default` row per authored stage. After a splitting intent, additional ready-intents never reach plan or implement, approval gates cannot settle per branch, and one branch failure aborts the rest.

## Surface

Primary: `v2/src/daemon/pipeline-execution.ts`. In-scope: `pipeline-stage-dispatch.ts` artifact carry-forward, `pipeline-execution.test.ts`, branch-scoped `pipeline_approve` / `pipeline_reject` resolution in `pipeline-execution.ts` and `daemon.ts`. Depends on subspec 00.

Out of scope for this spec (sibling `pipeline-branch-operator-cli`): operator `pipeline list` / `wait` projection, CLI syntax, and operator-runbook updates. This spec owns daemon execution and RPC gate scoping only.

## Prerequisites

- Subspec 00 landed: chained resolution fans out per `downstreamInputs` entry.
- Pipeline stage rows are keyed by `(stageId, branchKey)` and `createPipelineStageBranch` admits additional rows (`state-store.ts`).
- Durable approval gates and `pipeline_approve` / `pipeline_reject` RPC handlers exist (`v2/spec/completed/20260730T081814Z-pipeline-daemon-approval-and-stage-resume/`).

## Decisions

- From the splitting intent stage forward, each downstream input runs every subsequent authored stage in definition order on its own `branchKey` — rules out picking one input, failing the split, or aborting remaining branches on the first failure.
- `branchKey` is the ready-intent file basename without `.md` — rules out opaque or ordinal-only keys with no file correlation.
- After splitting intent succeeds, pre-admitted `default` rows for downstream stages are reconciled so they do not spuriously dispatch, double-execute, or leave ambiguous state once per-branch rows exist — rules out deferring reconciliation to operator CLI.
- Stage artifacts are keyed by `(stageId, branchKey)`; branch B's plan artifact must not overwrite branch A's — rules out last-write-wins per `stageId` only.
- `pipeline_approve` and `pipeline_reject` accept `branchKey` and resolve the approval row by `(pipelineId, stageId, branchKey)`; when multiple branch rows exist at the stage and `branchKey` is omitted, the RPC refuses — rules out one shared gate decision or implicit first-branch targeting.
- `runPipeline` does not halt the whole pipeline when one branch fails while sibling branch rows remain actionable — rules out whole-pipeline abort on first branch failure.
- `skipRemainingStages` applies only within one `branchKey`, not across all rows at a position — rules out suffix skip spanning branches.
- `continuePipeline` / `resumePipeline` advance actionable per-branch rows independently; aggregate terminal settlement waits until every branch row is terminal or skipped within its branch — rules out aggregate resume blocking sibling branches.
- One branch's failure or rejection does not skip or fail sibling branches' remaining stages — rules out cross-branch stage suppression.
- Derived terminal `succeeded` only when every fan-out branch reaches terminal success; otherwise aggregate state is non-`succeeded` and pipeline-level `failureDetail` names each failed or rejected `branchKey` — rules out reporting `succeeded` while a branch failed or naming only `state !== "succeeded"`.
- Cross-branch ordering is unspecified; sequential branch execution is acceptable — rules out blocking on a concurrency design.
- Out of scope: fan-out from a plan stage, fan-in / cross-branch synchronization, and multi-branch terminal publication when every implement branch succeeds (unchanged / deferred until a definition needs it) — rules out plan-split, merge gates, or silent first-wins publication in this slice.

## Task checklist

- After splitting intent succeeds, admit per-input branch rows, reconcile pre-admitted `default` downstream rows, and wire subspec 00 multi-resolution dispatch per branch.
- Scope `findStageRecord`, `advanceWorkflowStage`, `advanceApprovalStage`, artifact lookup/storage, and approval RPC row lookup by `branchKey`.
- Require `branchKey` on `pipeline_approve` / `pipeline_reject` when multiple branch rows exist at the stage.
- Extend `derivePipelineState` (and terminal settlement) to aggregate across fan-out branches with `failureDetail` naming failed/rejected `branchKey`s.
- Add `pipeline-execution.test.ts` two-branch fixtures: default-row reconciliation, per-branch gate isolation, mixed failure/success and rejection/success terminal derivation, branch artifact isolation, guard inversions.
- Record fan-out execution contract in `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md` (slug: `pipeline-intent-split-fan-out-execution`).

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` — after fan-out admission, no `default` branch dispatches plan or implement while per-branch rows exist; leaving `default` rows actionable makes the test fail.
- [ ] `pipeline-execution.test.ts` — `pipeline approve` / `pipeline reject` with `branchKey` on one branch leaves the other branch's gate `awaiting`; omitting `branchKey` when multiple branch rows exist is refused; a cross-branch decision leak makes the test fail.
- [ ] `pipeline-execution.test.ts` — with one branch failed and one succeeded, the pipeline settles a non-`succeeded` terminal state whose `failureDetail` names the failed `branchKey` while the succeeding branch still reaches its terminal action; inverting either half makes the test fail.
- [ ] `pipeline-execution.test.ts` — with one branch rejected and one succeeded, aggregate is non-`succeeded`, `failureDetail` names the rejected `branchKey`, and the succeeding branch still reaches terminal success; aborting the succeeding branch makes the test fail.
- [ ] `pipeline-execution.test.ts` — branch A and branch B plan artifacts coexist and resolve independently; last-write-wins per `stageId` makes the test fail.
- [ ] `pipeline-execution.test.ts` — `"continues past an approved gate and dispatches the next workflow stage"` stays green for single-branch (`default`) pipelines.
- [ ] `bun run typecheck` exits zero.
- [ ] `bun run test:v2` exits zero.

## Documentation updates

- `v2/docs/daemon-host.md` § Pipeline stage resolution — downstream stages run per branch from the splitting stage forward; approval decisions, artifact isolation, and terminal settlement are branch-scoped.
- `v2/docs/v1-behaviors.md` — record pipeline fan-out execution contract.
