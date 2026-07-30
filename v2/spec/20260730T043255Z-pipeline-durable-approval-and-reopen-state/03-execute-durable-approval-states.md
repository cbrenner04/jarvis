# Execute durable approval states

## Problem

- Ordered progression does not make a reached gate durable or give `awaiting`, `approved`, and `rejected`
  distinct execution and pipeline-state meanings.

## Decisions

- On reaching an approval after succeeded predecessors, request its `pending` to `awaiting` transition before
  returning; later rows stay pending and undispatched while it awaits.
- An awaiting gate blocks progression, an approved gate permits the eligible next stage, and a rejected gate
  deterministically settles the pipeline without later dispatch; rules out treating all approval statuses as a
  paused run.
- If the conditional boundary write refuses, reload only the addressed durable row: apply its authoritative
  approval meaning when it is awaiting, approved, or rejected; otherwise settle the pipeline deterministically as
  failed without attributing the write to another row or skipping the suffix.

## Task checklist

- Record reached approval boundaries from ordered progression.
- Preserve approval rows during restart reconciliation and derive pipeline state and execution behavior from each
  durable approval status.
- Add focused execution and refusal-path coverage.
- Update daemon and v2 behavior docs.

## Acceptance criteria

- [x] Reaching a pending approval after succeeded predecessors persists `awaiting` under its stable
      `PipelineStageRecord.id` before the loop returns; every later row remains pending and undispatched.
- [x] Ordered execution blocks at `awaiting`, continues past `approved`, and settles deterministically at
      `rejected`; pipeline-state derivation distinguishes all three states.
- [x] Restart reconciliation leaves `awaiting`, `approved`, and `rejected` approval rows unchanged, including their
      preceding succeeded and later pending siblings.
- [x] A refused boundary write is handled only from the reloaded requested row: it neither changes nor attributes a
      transition to another stage, never dispatches the suffix without approval, and leaves a deterministic durable
      pipeline outcome.
- [x] New or updated `v2/src/daemon/pipeline-execution.test.ts` and `v2/src/persistence/state-store.test.ts`
      regressions for reached gates, approval reconciliation and execution meanings, and boundary refusal fail
      against the pre-fix behavior.
- [x] Inverting the approval-stop, approved-continue, rejected-settlement, or boundary-refusal guard makes its
      targeted regression fail; negative cases prove decided rows are not rewritten and forbidden dispatch is absent.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [x] `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md` document durable approval execution and link
      repository details to `v2/docs/state-store.md`.

## Documentation updates

- `v2/docs/daemon-host.md` — reached-gate, approval-state, and refusal behavior.
- `v2/docs/v1-behaviors.md` — additive v2 durable approval semantics.
