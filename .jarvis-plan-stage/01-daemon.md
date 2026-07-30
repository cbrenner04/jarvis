# Daemon

## Problem

- The ordered loop records `awaiting` at approval boundaries, but no daemon-owned operation admits `approved` or `rejected` for a matching stage and continues or settles from that durable row.

## Prerequisites

- Reaching an approval stage durably records `awaiting`, and `commitApprovalDecision` targets the stable `PipelineStageRecord.id` (`v2/src/persistence/state-store.ts`, `v2/spec/20260730T043255Z-pipeline-durable-approval-and-reopen-state/`).
- Awaiting approval rows and pipeline admission `context` survive store reopen and restart reconciliation (`state-store.test.ts`, `pipeline-execution.test.ts`).
- `continuePipeline` resumes the ordered loop from persisted context after owner claim (`pipeline-execution.ts`).

## Decisions

- Add `pipeline_approve` and `pipeline_reject` RPC handlers keyed by `{ pipelineId, stageId }` where `stageId` is the authored stage identifier; rules out unscoped decisions that can settle a different gate.
- Mutating pipeline RPC retirement follows the same `daemon_superseded` guard as `pipeline_start`; rules out a separate supersession policy for decisions.


## Task checklist

- Add daemon-owned approve/reject entry points in `pipeline-execution.ts` composing `commitApprovalDecision` with optional `continuePipeline`.
- Register `pipeline_approve` and `pipeline_reject` handlers in `daemon.ts` with validation, stage-row resolution, async continuation, and focused handler coverage.
- Extend `pipeline-execution.test.ts` for reached-gate blocking, approve continuation, reject terminal settlement, duplicate refusal, restart-then-decide continuation, and guard inversion.
- Document approval decision admission, RPC contracts, and continuation composition in `daemon-host.md` and `v1-behaviors.md`.

## Acceptance criteria

- [ ] A regression in `v2/src/daemon/pipeline-execution.test.ts` fails on baseline and then proves a pipeline that reaches `awaiting` dispatches no later workflow stage until `pipeline_approve` applies a matching decision.
- [ ] Inverting the awaiting-block, approve-continue, reject-settle, first-writer, or refused-decision-no-dispatch guard makes `v2/src/daemon/pipeline-execution.test.ts` fail; negative cases prove duplicate decisions and non-awaiting targets dispatch nothing.

## Documentation updates

- `v2/docs/daemon-host.md` — `pipeline_approve` / `pipeline_reject` RPC contracts, authored-stage targeting, decision admission, approve continuation, reject terminal settlement, duplicate refusal, and client-detach continuation.
- `v2/docs/v1-behaviors.md` — additive v2 daemon pipeline approval decision behavior.
