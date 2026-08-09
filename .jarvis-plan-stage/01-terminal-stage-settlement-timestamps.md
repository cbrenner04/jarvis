# Terminal stage settlement timestamps

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

The state store backfills `endedAt` on a terminal stage patch, but daemon settlement writers do not all state that contract: the two `skipped` writes in `pipeline-execution.ts` omit it. Existing tests spot-check dispatch outcomes and do not enumerate every terminal write or pin the legitimate failed-before-start shape.

## Decision ledger

- Every daemon settlement patch carrying `succeeded`, `failed`, `interrupted`, or `skipped` also carries numeric `endedAt`, even though `StateStore.updateStage` remains a persistence backstop. Rules out relying on store-side derivation, which leaves mocked writers and future alternate stores unable to observe the settlement contract.
- A source-backed test inventories every terminal patch in `pipeline-stage-dispatch.ts` and `pipeline-execution.ts`. Rules out behavior-only spot checks that cannot reach private refusal, catch, suffix-skip, and stranded-stage paths.
- A throw before entry-run admission settles `failed` with `endedAt` and no `startedAt`; `pipeline_list` preserves durable `startedAt: null`. Rules out inventing a start timestamp to make elapsed time renderable.
- No TUI rendering or elapsed aggregation change. Rules out absorbing later observation-consumer work into this settlement slice.

## Prerequisites

- `StateStore.updateStage` stamps `endedAt` on every terminal stage status and never synthesizes `startedAt`.
- `projectPipelineSnapshot` projects durable `startedAt` and `endedAt` without following live transitions.

## Tasks

- Audit terminal `updateStage` patches in `v2/src/daemon/pipeline-stage-dispatch.ts`: `settleUnexpectedThrow`, each terminal branch of `applyEntryRunSettlement`, and dispatch refusal; keep or add explicit `endedAt` on each.
- Audit terminal `updateStage` patches in `v2/src/daemon/pipeline-execution.ts`: fan-out default-row skip in `admitFanOutBranches`, `settleApprovalBoundaryFailure`, `skipRemainingStages`, `failWorkflowStageAt`, the `advanceWorkflowStage` catch, and `failStrandedPipelineStage`; add explicit `endedAt` to both skipped writes, retain it on failures, and keep the `skipRemainingStages` write on the exact single line named by the mutation directive.
- Add `pipeline-stage-dispatch.test.ts` coverage that enumerates the named terminal write sites in both modules and rejects any terminal patch without `endedAt`; separately drive a pre-admission throw and assert the failed-before-start patch.
- Add `daemon-pipeline-observation.test.ts` coverage projecting a durable failed-before-start row with `startedAt: null` and non-null `endedAt` through `pipeline_list`.
- Apply the Documentation updates.
- Run `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `v2/src/daemon/pipeline-stage-dispatch.test.ts` — `every terminal pipeline stage write carries endedAt` enumerates every terminal write site in `pipeline-stage-dispatch.ts` and `pipeline-execution.ts`, asserts each terminal patch carries `endedAt`, and fails against the pre-fix `skipRemainingStages` patch containing only `status: "skipped"`.
- [ ] `v2/src/daemon/pipeline-stage-dispatch.test.ts` — `a pre-admission throw records failed before start` asserts `status: "failed"`, numeric `endedAt`, no `startedAt`, and no workflow linkage.
- [ ] `v2/src/daemon/daemon-pipeline-observation.test.ts` — `pipeline_list preserves null startedAt for a stage that failed before start` asserts the wire row is terminal with non-null `endedAt` and `startedAt: null`.
- [ ] `v2/src/daemon/pipeline-stage-dispatch.test.ts` — `every terminal pipeline stage write carries endedAt`; Keystone checkpoint: its test body carries `// @mutate v2/src/daemon/pipeline-execution.ts "store.updateStage({ pipelineId, stageId: record.stageId, branchKey, patch: { status: \"skipped\", endedAt: Date.now() } });" -> "store.updateStage({ pipelineId, stageId: record.stageId, branchKey, patch: { status: \"skipped\" } });"`, restoring the finishless caller patch, and the mutation turns the regression RED.
- [ ] `v2/src/daemon/pipeline-stage-dispatch.test.ts` — `every terminal pipeline stage write carries endedAt`; Mutation checkpoint: the linked terminal-patch mutation proves the inventory rejects a newly finishless settlement writer.
- [ ] `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md` describe the explicit settle-path `endedAt` guarantee and the failed-before-start wire shape.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § RPC methods `pipeline_list` row — a stage that failed before start projects non-null `endedAt` with `startedAt: null`; no start is synthesized.
- `v2/docs/daemon-host.md` § Pipeline stage dispatch and ordered progression — every daemon terminal settlement patch, including skipped suffix/default rows, carries `endedAt`; pre-admission throws retain the failed-before-start shape.
- `v2/docs/v1-behaviors.md` — record the daemon settlement-writer guarantee and unchanged null `startedAt` projection for failures before admission.
