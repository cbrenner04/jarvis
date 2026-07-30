# Persistence

## Problem

- The ordered loop records `awaiting` at approval boundaries, but no daemon-owned operation admits `approved` or `rejected` for a matching stage and continues or settles from that durable row.

## Prerequisites

- Reaching an approval stage durably records `awaiting`, and `commitApprovalDecision` targets the stable `PipelineStageRecord.id` (`v2/src/persistence/state-store.ts`, `v2/spec/20260730T043255Z-pipeline-durable-approval-and-reopen-state/`).
- Awaiting approval rows and pipeline admission `context` survive store reopen and restart reconciliation (`state-store.test.ts`, `pipeline-execution.test.ts`).
- `continuePipeline` resumes the ordered loop from persisted context after owner claim (`pipeline-execution.ts`).

## Decisions

- Resolve the authored `stageId` to one durable approval row before calling `commitApprovalDecision`; rules out writing decisions by pipeline ID alone.
- `pipeline_approve` records `approved` through `commitApprovalDecision` and, only when that write applies, asynchronously continues the ordered loop via `continuePipeline`; rules out optimistic continuation before durable admission.
- `pipeline_reject` records `rejected` through `commitApprovalDecision` and never dispatches a later stage; rules out implicit rerun or suffix dispatch after rejection.
- The first atomically admitted matching decision wins; duplicate or racing decisions return the store's named refusal with no additional dispatch; rules out last-writer-wins settlement or a second continuation.
- A refused decision (wrong row, non-awaiting row, non-approval row, or losing race) changes no other stage row and dispatches nothing; rules out fail-open progression.
- Decision handlers return after the durable write is admitted (or refused) and detach like `pipeline_start`; rules out client-held continuation.

## Task checklist

- Add daemon-owned approve/reject entry points in `pipeline-execution.ts` composing `commitApprovalDecision` with optional `continuePipeline`.
- Register `pipeline_approve` and `pipeline_reject` handlers in `daemon.ts` with validation, stage-row resolution, async continuation, and focused handler coverage.
- Extend `pipeline-execution.test.ts` for reached-gate blocking, approve continuation, reject terminal settlement, duplicate refusal, restart-then-decide continuation, and guard inversion.
- Document approval decision admission, RPC contracts, and continuation composition in `daemon-host.md` and `v1-behaviors.md`.

## Acceptance criteria

- [ ] The same regression file fails on baseline and then proves `pipeline_approve` on the matching awaiting stage advances to the next authored workflow stage, while `pipeline_reject` leaves every later stage undispatched and derives terminal `rejected`.
- [ ] After store close/reopen (including post-reconcile `interrupted` ownership), an awaiting pipeline remains awaiting until an explicit matching-stage decision, then `pipeline_approve` continues from persisted admission context without caller-supplied reconstruction.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.


## Documentation updates
