# Partition-time stage dispatch claim

## Problem

Two concurrent continuations for one pipeline can both read a `(stageId, branchKey)` row as `pending`, both dispatch, and the loser writes `failed` over the winner's `running` row.

## Surface

Primary: `v2/src/daemon/pipeline-execution.ts`, `v2/src/daemon/pipeline-stage-dispatch.ts`. In-scope: `pipeline-execution.test.ts`, `daemon-pipeline-approval.test.ts` store completeness, unreachable-guard cleanup in the dispatch partition path.

## Prerequisites

- Subspec 00 landed: `pipeline_stage_admission` claim/release/load on `StateStore`.
- Stage linkage holds through settlement (`v2/spec/completed/20260803T190421Z-stage-entry-run-linkage/`).
- Fan-out sibling dispatch stays concurrent with in-memory `dispatchClaims` for within-run coordination (`v2/spec/20260803T214753Z-fan-out-concurrent-sibling-dispatch/`).

## Decisions

- Acquire a durable stage-admission claim at dispatch partition time, before `dispatch(steps)` returns — rules out post-dispatch admission that leaves a loser free to overwrite the winner.
- A lost claim neither dispatches nor writes `failed`; re-read the stage row and stop or adopt the winner's live linkage — rules out treating claim loss as stage failure.
- Retain in-memory `dispatchClaims` for within-run fan-out sibling coordination — rules out removing the map or replacing fan-out peer waits with durable stage claims.
- A guard made unreachable by this fix is deleted or proven by an exported pure predicate with both truth directions tested — rules out `@mutate` directives on guards that cannot fire.
- Out of scope: `derivePipelineState` terminality, retry/backoff, `multiple_failed_stages` resume refusal, serializing recovery/restart branch walks beyond claim-safety.

## Task checklist

- Wire durable stage-admission claim/release around the dispatch partition in `advanceWorkflowStage` / `dispatchPipelineStage` (claim before `dispatch(steps)`; release after the partition completes or on the existing live-entry-run early-exit paths).
- On claim refusal, return without dispatch and without `failed` / `skipRemainingStages` side effects for that stage row.
- Add `pipeline-execution.test.ts` regression `"two concurrent continuations dispatch a given stage row exactly once"`: same owner, two overlapping `continuePipeline` calls, one pending `(stageId, branchKey)`; deferred `dispatch` or `wait` so both continuations reach the partition; assert exactly one dispatch and the loser leaves the row `running` (not `failed`) while the winner's entry run is live.
- Pin `// @mutate` on the claim-lost no-dispatch/no-fail guard; the concurrent-continuation regression must go RED.
- Audit dispatch-path guards made unreachable by claim-before-dispatch; delete each or extract to a tested exported predicate.
- Ensure `fakeStore` in `pipeline-execution.test.ts` and `openStateStore` in `daemon-pipeline-approval.test.ts` implement every `StateStore` method the dispatch path calls, including the three admission methods.
- Update `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` — `"two concurrent continuations dispatch a given stage row exactly once"` fails against baseline; the loser neither dispatches nor writes `failed` while the winner's entry run is live; linked `// @mutate` on the claim-lost guard makes the regression fail.
- [ ] `pipeline-execution.test.ts` and `daemon-pipeline-approval.test.ts` complete without `StateStore` method gaps on the dispatch path (fake doubles in execution tests; real SQL store in approval tests).
- [ ] `pipeline-execution.test.ts` — `"linear fan-out sibling plan stages reach running concurrently without worktree_claimed false positive"` and `"live-linked running stage row is not terminalized while its entry run is still live"` stay green.
- [ ] `bun run typecheck`, `bun run check`, `bun run lint:md`, `bun run test:v2`, and `bun run test:integration:v2` exit zero.

## Documentation updates

- `v2/docs/daemon-host.md` — partition-time durable stage admission before workflow dispatch; lost-claim behavior (no dispatch, no `failed` overwrite).
- `v2/docs/v1-behaviors.md` — record changed v2 fan-out dispatch claim behavior under concurrent continuations.
