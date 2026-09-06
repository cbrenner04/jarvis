# Adoption durable stage claim

## Problem

`dispatchPipelineStage` holds durable `pipeline_stage_admission` for fresh dispatch, but adoption paths (`adoptRunningWorkflowStage`, the refused-claim adopt branch in `dispatchPipelineStage`, and fan-out `runFanOutBranchAction` live-link adopt) coordinate only through in-memory `dispatchClaims`. Overlapping continuations across processes or daemon restarts can both adopt or settle the same `running` row without competing for the durable partition claim.

## Surface

Primary: `v2/src/daemon/pipeline-execution.ts`, `v2/src/daemon/pipeline-stage-dispatch.ts`. In-scope: `pipeline-execution.test.ts` fake/real store doubles for admission methods on adopt paths.

## Prerequisites

- Durable `pipeline_stage_admission` claim/release/load on `StateStore` (`v2/spec/completed/20260804T152043Z-pipeline-stage-dispatch-claim/`).
- `dispatchPipelineStage` claims before `dispatch(steps)` and adopts on refused claim when the row is `running` with a live linked entry run (`v2/spec/completed/20260804T152043Z-pipeline-stage-dispatch-claim/01-partition-time-stage-dispatch-claim.md`).
- Store-owned settlement from terminal entry runs (`v2/spec/completed/20260830T062002Z-durable-run-backed-stage-settlement/`).

## Decision ledger

- Supersedes `v2/spec/completed/20260804T152043Z-pipeline-stage-dispatch-claim/01-partition-time-stage-dispatch-claim.md` refused-claim adopt-on-live-link behavior and `v2/docs/daemon-host.md` ~605 prose that documents adopt-on-refused-claim; loser on refused durable admission re-reads without adopt, settle, or dispatch; rules out half-migrated dispatch refused-claim path still calling `adoptAndSettlePipelineStage`.
- Every cross-continuation adopt/settle path acquires durable `pipeline_stage_admission` for `(pipelineId, stageId, branchKey)` before `adoptAndSettlePipelineStage`; rules out adoption surviving as a process-local-only ownership decision.
- When dispatch already holds `pipeline_stage_admission` for the partition, adopt paths must not double-claim or double-release; rules out duplicate claim/release on the refused-claim branch and on `adoptRunningWorkflowStage` after dispatch holds the partition.
- A refused durable claim on an adopt path re-reads the stage and entry-run rows and returns without dispatch, settlement, or terminal patch writes; rules out concurrent adopters both calling `wait()` and writing terminal state for the same row.
- In-memory `dispatchClaims` remain scoped to one `runPipeline` / `continuePipeline` invocation for fan-out sibling coordination within that invocation; rules out removing `dispatchClaims` or replacing them with a second durable claim on the same partition in the same process.
- Deferred to first consumer: whether refused-claim adopt retries settlement when the winner's adopt is still in flight — pin when a test constructs cross-process overlap mid-settle.

## Task checklist

- Add a shared adopt helper (or extend `adoptAndSettlePipelineStage` callers) that claims durable admission, runs adopt/settle under the claim, and releases in `finally` on the same partition-completion contract as dispatch.
- Route `adoptRunningWorkflowStage`, the refused-claim adopt branch in `dispatchPipelineStage`, and fan-out live-link adopt in `runFanOutBranchAction` through the durable claim helper; keep in-memory `withDispatchClaim` as an inner layer only where fan-out siblings within one invocation still need it.
- Add `pipeline-execution.test.ts` regression `adoption of an already-dispatched stage loses the durable claim without a second dispatch or settlement`: exercises `dispatchPipelineStage` refused-claim branch (`pipeline-stage-dispatch.ts` ~348) and `adoptRunningWorkflowStage` (or fan-out live-link adopt in `runFanOutBranchAction`); two overlapping continuations against one `running` row with a live linked entry run; deferred adopt/settle on the winner; assert exactly one settlement write and the loser performs no dispatch, no `adoptAndSettlePipelineStage` settlement, and no terminal patch while the winner's entry run is still live; pin `// @mutate` on `v2/src/daemon/pipeline-stage-dispatch.ts` `if (claim.kind === "refused")` loser no-settle guard and the shared adopt-helper claim gate.
- Note distinction from `two concurrent continuations dispatch a given stage row exactly once` (pending-row dispatch race, `@mutate` on dispatch early return) vs this test (live-linked `running` row, loser must not settle).
- Ensure test doubles implement `claimPipelineStageAdmission` / `releasePipelineStageAdmission` on every adopt path exercised by the regression.
- Update `v2/docs/daemon-host.md` durable-admission section (~605) and fan-out paragraph (~633) to name durable adoption for cross-continuation ownership and limit in-memory `dispatchClaims` to within-invocation fan-out sibling coordination.
- Update `v2/docs/v1-behaviors.md` for cross-process adopt ownership through durable `pipeline_stage_admission`.
- Run `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `v2/src/daemon/pipeline-execution.test.ts` test `adoption of an already-dispatched stage loses the durable claim without a second dispatch or settlement` exercises `dispatchPipelineStage` refused-claim branch and at least one non-dispatch adopt seam (`adoptRunningWorkflowStage` or fan-out live-link adopt in `runFanOutBranchAction`); drives two overlapping continuations on one live-linked `running` row; proves exactly one settlement and that the loser dispatches and settles nothing while the winner's entry run is live; fails when adopt paths skip the durable claim; linked `// @mutate` on `v2/src/daemon/pipeline-stage-dispatch.ts` `if (claim.kind === "refused")` loser no-settle guard and the shared adopt-helper claim gate makes the regression fail.
- [ ] `v2/docs/daemon-host.md` documents durable `pipeline_stage_admission` guarding dispatch and adoption for the same `(pipelineId, stageId, branchKey)` partition, corrects ~633 fan-out prose so cross-continuation adopt ownership is not attributed to in-memory `dispatchClaims`, and names `dispatchClaims` as within-invocation fan-out coordination only.
- [ ] `v2/docs/v1-behaviors.md` records cross-process adopt ownership through durable `pipeline_stage_admission` (lost-claim adopt re-reads without settle).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/daemon-host.md` — durable claim ownership across dispatch and adoption; lost-claim adopt behavior; explicit naming vs in-memory `dispatchClaims`.
- `v2/docs/v1-behaviors.md` — durable cross-process adopt ownership.
