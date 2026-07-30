# Reopen a failed pipeline in place

## Problem

- A failed stage and its `skipped` suffix remain durable but have no operation that makes only that continuation
  point eligible again.
- Reconciliation can rewrite `skipped` rows as `interrupted`, erasing which suffix failure blocked.

## Decisions

- Reopen the first failed stage and its following `skipped` suffix in place as `pending`; rules out replacement
  rows and restart from stage zero.
- Clear workflow invocation, timestamps, artifact, and failure detail only on reopened rows; rules out redispatch
  with stale attempt state or erasing succeeded-stage evidence.
- Return the failed stage ID as the continuation point and refuse reopen when none exists; rules out caller-side
  row inference and silently reopening succeeded, rejected, awaiting, or never-started pipelines.
- Treat `skipped` as reconciliation-stable; rules out losing the blocked suffix before reopen.
- Deferred to first consumer: pipeline ownership refresh during reopen — pin when daemon resume needs it.

## Task checklist

- Add the atomic failed-pipeline reopen repository operation.
- Preserve skipped suffix rows during reconciliation.
- Add focused identity-preservation, reset, refusal, close/reopen, and reconciliation regressions.
- Update persistence, reconciliation, and v2 behavior docs.

## Acceptance criteria

- [ ] Reopening a failed pipeline returns that stage ID, preserves every preceding succeeded row's durable ID,
      workflow invocation ID, and artifact, and resets only the failed row and its `skipped` suffix for
      eligibility.
- [ ] Reopened rows retain their durable IDs but read `pending` with prior-attempt lifecycle payloads cleared;
      unrelated siblings are byte-for-byte unchanged.
- [ ] Closing and reopening before the operation, including after restart reconciliation, retains the failed
      continuation point and blocked suffix.
- [ ] Reopen refuses a pipeline with no failed stage and changes no row.
- [ ] New or updated `v2/src/persistence/state-store.test.ts` regressions for failed-pipeline continuation fail
      against the pre-fix store.
- [ ] Inverting the failed-boundary, suffix-scope, lifecycle-clear, or skipped-reconciliation guard makes its
      targeted `v2/src/persistence/state-store.test.ts` regression fail; negative cases prove predecessor and
      refusal-path writes are absent.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/state-store.md`, `v2/docs/daemon-host.md`, and `v2/docs/v1-behaviors.md` document in-place failed
      reopen and skipped-suffix restart behavior in their durable homes.

## Documentation updates

- `v2/docs/state-store.md` — failed-pipeline reopen operation and field-preservation contract.
- `v2/docs/daemon-host.md` — restart reconciliation preserves a failed pipeline's skipped suffix.
- `v2/docs/v1-behaviors.md` — additive v2 stage-scoped failed-pipeline reopen behavior.
