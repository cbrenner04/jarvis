---
name: pipeline-durable-approval-and-reopen-state
---

# Durable pipeline approval and reopen state

## Prerequisites

- Validated pipelines persist immutable definitions and ordered stage records with stable stage IDs.
- Daemon restart reconciliation preserves succeeded stages and undispatched stage rows.

## Problem

Approval and stage-scoped continuation need durable state that can be reopened without reconstructing a pipeline from workflow rows or client memory.

## Decisions

- Reaching an approval stage persists `awaiting`, and an atomic conditional decision persists `approved` or `rejected` only while that stage awaits; the first matching decision wins and duplicates or races are refused; rules out representing approval as a paused workflow run, an unscoped pipeline flag, or last-writer-wins settlement.
- Pipeline admission persists the execution context required to resolve later stages after daemon restart; rules out requiring the approving or resuming client to reconstruct prior admission input.
- Restart reconciliation preserves an `awaiting` approval stage without approving or interrupting it; rules out fail-open and treating a durable review boundary as abandoned active work.
- Reopening a failed pipeline preserves every prior succeeded stage's identity, invocation ID, and artifact while making only the failed stage and its blocked suffix eligible again; rules out replacement rows and restart from stage zero.

## Acceptance criteria

- [ ] Closing and reopening the state store preserves an approval stage in each explicit `awaiting`, `approved`, and `rejected` state under its stable stage ID.
- [ ] Restart reconciliation leaves an `awaiting` approval stage awaiting and changes no prior succeeded or later pending stage.
- [ ] A reopened failed pipeline retains every prior succeeded stage's durable identity, workflow invocation ID, and artifact while exposing the failed stage as the continuation point.
- [ ] Persisted pipeline execution context is sufficient to resolve a later workflow stage after the admitting process is gone.
- [ ] `v2/src/persistence/state-store.test.ts` regression coverage for durable approval decisions, reopen state, and failed-pipeline continuation fails against the pre-fix store behavior.

## Documentation updates

- `v2/docs/state-store.md` — approval status vocabulary, persisted continuation context, reconciliation, and stage-scoped reopen operations.
- `v2/docs/v1-behaviors.md` — v2 pipeline approval durability and reopen behavior.
