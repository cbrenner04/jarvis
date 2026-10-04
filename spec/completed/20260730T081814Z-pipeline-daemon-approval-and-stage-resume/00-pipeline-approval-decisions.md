# Daemon-owned approval decisions

## Problem

- The ordered loop records `awaiting` at approval boundaries, but no daemon-owned operation admits `approved` or `rejected` for a matching stage and continues or settles from that durable row.

## Prerequisites

- Reaching an approval stage durably records `awaiting`, and `commitApprovalDecision` targets the stable `PipelineStageRecord.id` (`v2/src/persistence/state-store.ts`, `v2/spec/20260730T043255Z-pipeline-durable-approval-and-reopen-state/`).
- Awaiting approval rows and pipeline admission `context` survive store reopen and restart reconciliation (`state-store.test.ts`, `pipeline-execution.test.ts`).
- `continuePipeline` resumes the ordered loop from persisted context after owner claim (`pipeline-execution.ts`).

## Decisions

- Add `pipeline_approve` and `pipeline_reject` RPC handlers keyed by `{ pipelineId, stageId }` where `stageId` is the authored stage identifier; rules out unscoped decisions that can settle a different gate.
- Resolve the authored `stageId` to one durable approval row before calling `commitApprovalDecision`; rules out writing decisions by pipeline ID alone.
- `pipeline_approve` records `approved` through `commitApprovalDecision` and, only when that write applies, asynchronously continues the ordered loop via `continuePipeline`; rules out optimistic continuation before durable admission.
- `pipeline_reject` records `rejected` through `commitApprovalDecision` and never dispatches a later stage; rules out implicit rerun or suffix dispatch after rejection.
- The first atomically admitted matching decision wins; duplicate or racing decisions return the store's named refusal with no additional dispatch; rules out last-writer-wins settlement or a second continuation.
- A refused decision (wrong row, non-approval target, non-awaiting row, or losing race) changes no other stage row and dispatches nothing; rules out fail-open progression. RPC responses surface store refusal reasons (`status_not_awaiting`, `invalid_decision`, `stage_not_found`, `not_approval_stage`, etc.) without masking them.
- Decision handlers return after the durable write is admitted (or refused) and detach like `pipeline_start`; rules out client-held continuation.
- Mutating pipeline RPC retirement follows the same `daemon_superseded` guard as `pipeline_start`; rules out a separate supersession policy for decisions.

## Task checklist

- Add daemon-owned approve/reject entry points in `pipeline-execution.ts` composing `commitApprovalDecision` with optional `continuePipeline`.
- Register `pipeline_approve` and `pipeline_reject` handlers in `daemon.ts` with validation, stage-row resolution, async continuation, and focused handler coverage.
- Extend `pipeline-execution.test.ts` for reached-gate blocking, approve continuation, reject terminal settlement, RPC apply/refuse outcomes, duplicate refusal, restart-then-decide continuation, handler guards, and guard inversion.
- Document approval decision admission, RPC contracts, and continuation composition in `daemon-host.md` and `v1-behaviors.md`.

## Acceptance criteria

- [x] A regression in `v2/src/daemon/pipeline-execution.test.ts` fails on baseline and then proves a pipeline that reaches an approval gate records `awaiting` on that row and dispatches no later workflow stage until `pipeline_approve` applies a matching decision.
- [x] The same regression file fails on baseline and then proves `pipeline_approve` on the matching awaiting stage advances to the next authored workflow stage, while `pipeline_reject` leaves every later stage undispatched and derives terminal `rejected`.
- [x] The same regression file fails on baseline and then proves RPC apply vs refusal for wrong `stageId`, non-approval target, non-awaiting row, and duplicate/racing decisions: successful apply returns applied outcome and (for approve) dispatches; each refusal returns the matching store reason (`status_not_awaiting`, `invalid_decision`, etc.), changes no other stage row, and dispatches nothing.
- [x] The same regression file fails on baseline and then proves that after store close/reopen (including post-reconcile `interrupted` ownership), an awaiting pipeline stays awaiting until an explicit matching-stage `pipeline_approve` or `pipeline_reject` through the RPC handler, and `pipeline_approve` then continues from persisted admission context without caller-supplied reconstruction.
- [x] Handler coverage in `daemon-pipeline-approval.test.ts` (or extended `daemon-pipeline-start.test.ts` / `daemon-retire-superseded.test.ts` patterns) fails on baseline and then proves missing/empty `pipelineId` or `stageId` returns `invalid_params`; `setRetiring` rejects approve/reject with `daemon_superseded` (inverting the guard admits work); and approve/reject return after the durable write before async `continuePipeline` runs.
- [x] Inverting the awaiting-block, approve-continue, reject-settle, first-writer, or refused-decision-no-dispatch guard makes `v2/src/daemon/pipeline-execution.test.ts` fail; negative cases prove duplicate decisions and refused targets dispatch nothing.

## Documentation updates

- `v2/docs/daemon-host.md` — `pipeline_approve` / `pipeline_reject` RPC contracts, authored-stage targeting, decision admission, approve continuation, reject terminal settlement, duplicate refusal, store refusal propagation, and client-detach continuation.
- `v2/docs/v1-behaviors.md` — additive v2 daemon pipeline approval decision behavior.
