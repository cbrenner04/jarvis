# Partition-time stage dispatch claim

## Problem

Two concurrent continuations for one pipeline can both read a `(stageId, branchKey)` row as `pending`, both dispatch, and the loser writes `failed` over the winner's `running` row.

## Surface

Primary: `v2/src/daemon/pipeline-execution.ts`, `v2/src/daemon/pipeline-stage-dispatch.ts`. In-scope: `pipeline-execution.test.ts`, `daemon-pipeline-approval.test.ts` store completeness, bounded unreachable-guard cleanup in `dispatchPipelineStage`.

## Prerequisites

- Subspec 00 landed: `pipeline_stage_admission` claim/release/load on `StateStore`.
- Stage linkage holds through settlement (`v2/spec/completed/20260803T190421Z-stage-entry-run-linkage/`).
- Fan-out sibling dispatch stays concurrent with in-memory `dispatchClaims` for within-run coordination (`v2/spec/20260803T214753Z-fan-out-concurrent-sibling-dispatch/`).

## Decisions

- **Single claim site:** durable `pipeline_stage_admission` claim inside `dispatchPipelineStage` only (linear and fan-out paths converge there); no second acquisition on the linear path — rules out scattered or duplicated durable claims.
- Claim precedes the `dispatch(steps)` callback; release follows partition completion (entry-run settlement or existing live-entry early-exit paths), not when `dispatch(steps)` returns while `wait()` is still outstanding — rules out releasing during an in-flight partition.
- **Release contract (pins subspec 00 deferral):** `release` requires `(pipelineId, stageId, branchKey)` plus matching holder identity recorded at claim time — rules out key-only release clearing another continuation’s row.
- **Two-layer ordering:** durable `pipeline_stage_admission` in `dispatchPipelineStage` for cross-continuation coordination; in-memory `dispatchClaims` retained for within-run fan-out sibling coordination; no durable claim in fan-out resolution/adopt paths — rules out duplicate or inverted claim ordering.
- **Lost claim:** dispatch path does not call `load()`; refused claim triggers stage-row re-read — if `running` with live `workflowInvocationId`, adopt via the existing adopt path; otherwise return without `failWorkflowStageAt` / `skipRemainingStages` for that row — rules out treating claim loss as stage failure or leaving a `pending` row mis-handled in `advanceWorkflowStage`.
- **Crash/restart (out of scope):** daemon restart may leave a held `pipeline_stage_admission` row when the owning entry run did not settle and release did not run; document expected operator intervention (clear row or wait for settlement/release) — rules out implicit orphan reconciliation in this spec.
- A guard made unreachable by this fix is deleted or proven by an exported pure predicate with both truth directions tested — rules out `@mutate` directives on guards that cannot fire.
- Out of scope: `derivePipelineState` terminality, retry/backoff, `multiple_failed_stages` resume refusal, orphan-row reconciliation sweeps, serializing recovery/restart branch walks beyond claim-safety.

## Task checklist

- Resolve subspec 00’s deferred release contract: holder-identity column shape on claim; `release` keyed by `(pipelineId, stageId, branchKey)` with holder match; release only on partition completion (settlement or live-entry early exit), never on `dispatch(steps)` return alone.
- Wire durable `pipeline_stage_admission` claim/release only in `dispatchPipelineStage` (claim before `dispatch(steps)`; release after partition completes or on existing live-entry-run early-exit paths).
- On refused claim: re-read stage row; adopt when `running` with live `workflowInvocationId`; otherwise return without dispatch and without `failed` / `skipRemainingStages` for that row.
- Add `pipeline-execution.test.ts` regression `"two concurrent continuations dispatch a given stage row exactly once"`: same owner, two overlapping `continuePipeline` calls, one pending `(stageId, branchKey)`; deferred `dispatch` or `wait` so both continuations reach `dispatchPipelineStage`; assert exactly one dispatch and the loser leaves the row `running` (not `failed`) while the winner's entry run is live.
- Pin `// @mutate` on the refused-claim early-return guard inside `dispatchPipelineStage` (not `advanceWorkflowStage` catch/resolution paths); the concurrent-continuation regression must go RED.
- Audit guards in `dispatchPipelineStage` / its immediate callers that assumed cross-continuation dedup via stage-row re-read alone and wrote `failed` when another continuation owned dispatch; delete each proven-dead guard or extract to a tested exported predicate — no open-ended dispatch-path audit.
- Ensure `fakeStore` in `pipeline-execution.test.ts` and `openStateStore` in `daemon-pipeline-approval.test.ts` implement every `StateStore` method the dispatch path calls, including the three admission methods.
- Update `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md` with explicit durable `pipeline_stage_admission` vs in-memory `dispatchClaims` naming.

## Acceptance criteria

- [x] `pipeline-execution.test.ts` — `"two concurrent continuations dispatch a given stage row exactly once"` fails against baseline; the loser neither dispatches nor writes `failed` while the winner's entry run is live; linked `// @mutate` on the refused-claim early-return in `dispatchPipelineStage` makes the regression fail.
- [x] `pipeline-execution.test.ts` and `daemon-pipeline-approval.test.ts` complete without `StateStore` method gaps on the dispatch path (fake doubles in execution tests; real SQL store in approval tests).
- [x] `pipeline-execution.test.ts` — `"linear fan-out sibling plan stages reach running concurrently without worktree_claimed false positive"` and `"live-linked running stage row is not terminalized while its entry run is still live"` stay green.
- [x] `bun run typecheck`, `bun run check`, `bun run lint:md`, `bun run test:v2`, and `bun run test:integration:v2` exit zero.

## Documentation updates

- `v2/docs/daemon-host.md` — single durable claim site in `dispatchPipelineStage` before workflow dispatch; hold through partition completion; lost-claim adopt vs stop; crash/restart stale-row operator expectation; explicit naming vs in-memory `dispatchClaims`.
- `v2/docs/v1-behaviors.md` — record changed v2 fan-out dispatch claim behavior under concurrent continuations; name durable `pipeline_stage_admission` vs in-memory `dispatchClaims`.
