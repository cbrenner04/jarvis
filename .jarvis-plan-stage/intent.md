---
name: pipeline-stage-dispatch-claim
---

# Pipeline stage dispatch is claim-safe under concurrent continuations

## Problem

Two concurrent continuations for one pipeline can both read a `(stageId, branchKey)` row as `pending`, both dispatch, and the loser writes `failed` over the winner's `running` row.

## Decisions

- Add durable `pipeline_stage_admission` claims via three `StateStore` methods — rules out in-memory-only dedup that dies on restart or cross-process races.
- Take the claim at partition time before dispatch returns — rules out post-dispatch admission that leaves a loser free to overwrite the winner.
- A lost claim neither dispatches nor writes `failed` — rules out treating claim loss as stage failure.
- A guard made unreachable by the fix is proven by an exported pure predicate with both truth directions tested, or deleted — rules out mutation directives on guards that cannot fire.
- Out of scope: `derivePipelineState` terminality, retry/backoff, `multiple_failed_stages` resume refusal.

## Acceptance criteria

- [ ] `state-store.test.ts` exercises all three `pipeline_stage_admission` methods against real SQL, including the no-row case; the regression fails without the schema and methods.
- [ ] `pipeline-execution.test.ts` proves two concurrent continuations dispatch a given `(stageId, branchKey)` exactly once and the loser neither dispatches nor writes `failed`; the regression fails against baseline.
- [ ] `pipeline-execution.test.ts` and `daemon-pipeline-approval.test.ts` complete with fake stores implementing every `StateStore` method the dispatch path calls.
- [ ] `bun run typecheck`, `bun run check`, `bun run lint:md`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — `pipeline_stage_admission` claim contract.
- `v2/docs/daemon-host.md` — partition-time stage admission before dispatch.
- `v2/docs/v1-behaviors.md` — record changed v2 fan-out dispatch claim behavior.

## Prerequisites

- A stage with an admitted entry run stays `running` until that run settles and is never `failed` while the run is live.
- Stage failure records the owning run's operator error and `nextAction`; `workflowInvocationId` names the entry run.
- Two sibling fan-out branches dispatch concurrently without either recording `failed` on a predecessor `worktree_claimed`.
- `stageArtifacts` resolution is branch-scoped so a branch never reads a sibling's artifact.
