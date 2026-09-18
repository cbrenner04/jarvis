---
name: linked-implement-routing-settles-a-real-outcome
---

# Linked implement routing that dispatches nothing settles a real outcome

## Problem

`linkedImplementRoutingFailureOutcome` (`v2/src/execution/workflow-runner.ts`) mints `crypto.randomUUID()` when no `existingRunId` exists, reports it via `onStepRunCreated` without `store.createRun`, and for `empty_index`/`already_complete` returns `kind: "complete"` carrying that phantom id.

## Decisions

- With no existing row, routing that dispatches no step returns a named refusal (e.g. `implement.already_complete`) carrying no run id; it never reports an unpersisted id through `onStepRunCreated`.
- With an existing row, behavior is unchanged: the real id is reused and settled.

## Acceptance criteria

- [ ] A runner test proves `already_complete` and `empty_index` routing with no existing row yields a named refusal and no `onStepRunCreated` call; it fails against the current phantom-id `complete`.
- [ ] A runner test proves every id reported via `onStepRunCreated` has a persisted row.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — admission persistence contract: an entry run id is reported only after its row is persisted; no-dispatch routing yields a named refusal.

## Prerequisites
