# Persist conditional approval operations

## Problem

- Approval rows lack stage-scoped, observable first-writer-wins operations.

## Decisions

- Address an approval row by durable `PipelineStageRecord.id`; retain its authored `stageId` as a separate,
  preserved key.
- Mark only a `kind: "approval"` row from `pending` to `awaiting`, then decide only that same awaiting row as
  `approved` or `rejected` with conditional writes; rules out workflow-stage decisions, pipeline-wide flags, and
  last-writer-wins settlement.
- Return an explicit applied or refused outcome with a reason and the addressed durable row ID; rules out silent
  no-ops for duplicate, wrong-stage, invalid-status, or losing-race requests.

## Task checklist

- Add stage-kind-checked conditional boundary and decision operations.
- Add outcome payloads and focused persistence coverage.
- Update state-store docs.

## Acceptance criteria

- [x] Closing and reopening the store preserves an approval row under the same `PipelineStageRecord.id`, with its
      authored `stageId` unchanged, in each explicit `awaiting`, `approved`, and `rejected` state.
- [x] A boundary request applies only to its matching `pending` approval row; workflow rows, wrong rows, and rows
      no longer pending return refusal and leave every row unchanged.
- [x] Two store handles deciding one awaiting approval admit exactly one `approved` or `rejected` result; duplicate,
      losing-race, wrong-stage, non-awaiting, and invalid-decision requests return refusal without mutation.
- [x] A new or updated `v2/src/persistence/state-store.test.ts` regression for durable approval operations and
      first-writer-wins outcomes fails against the pre-fix store behavior.
- [x] Inverting a pending-boundary, approval-kind, or awaiting-decision guard makes its targeted regression fail;
      negative cases prove refused writes are absent.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [x] `v2/docs/state-store.md` documents approval vocabulary, distinct row and authored identities, and conditional
      operation outcomes.

## Documentation updates

- `v2/docs/state-store.md` — approval operations, IDs, and refusal contract.
