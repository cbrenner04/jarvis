# Reopen a failed pipeline in place

## Problem

- A durably failed continuation point has no atomic, stage-scoped operation that makes it eligible again.

## Decisions

- A valid reopen shape has exactly one `failed` row, only `succeeded` predecessors, and a contiguous suffix of
  only `skipped` rows. Multiple failures, no failure, or any other later status refuse without mutation.
- Atomically reopen that failed row and exactly its skipped suffix in place as `pending`, clearing only their prior
  attempt invocation, timestamps, artifact, and failure detail; rules out replacement rows and stale attempts.
- Return an explicit applied or refused outcome. On application return the durable `PipelineStageRecord.id` of the
  failed continuation row, not its authored `stageId`; preserve both identities on every row.

## Task checklist

- Add atomic valid-shape detection and in-place reopen.
- Add focused preservation, refusal, close/reopen, and competing-writer coverage.
- Update state-store and v2 behavior docs.

## Acceptance criteria

- [x] Reopening a valid failed-plus-skipped-suffix pipeline has exactly one winning caller and returns the failed
      row's `PipelineStageRecord.id`; the returned row retains its authored `stageId` and becomes pending.
- [x] The operation retains every preceding succeeded row's durable ID, authored `stageId`, workflow invocation ID,
      and artifact, while retaining IDs but clearing only prior-attempt lifecycle payloads on the failed row and its
      exact contiguous skipped suffix.
- [x] Closing and reopening the store, including after restart reconciliation, retains the valid continuation point
      and blocked suffix before reopen.
- [x] No-failure, multiple-failure, malformed-suffix, and losing-concurrent-reopen requests return refusal and
      leave predecessor evidence, unrelated rows, and all stage payloads unchanged.
- [x] A new or updated `v2/src/persistence/state-store.test.ts` regression for in-place failed continuation and
      one-winner reopen fails against the pre-fix store behavior.
- [x] Inverting the valid-failed-boundary, suffix-scope, lifecycle-clear, or atomic-claim guard makes its targeted
      regression fail; negative cases prove refusal-path and predecessor writes are absent.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [x] `v2/docs/state-store.md` and `v2/docs/v1-behaviors.md` document valid reopen shape, return identity, field
      preservation, and refusal behavior.

## Documentation updates

- `v2/docs/state-store.md` — in-place reopen contract and identities.
- `v2/docs/v1-behaviors.md` — additive v2 failed-pipeline reopen behavior.
