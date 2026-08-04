# Durable pipeline stage admission store

## Problem

Cross-continuation dispatch races share no durable admission record. Two `continuePipeline` callers in the same process can both observe a `(stageId, branchKey)` row as `pending` because `claimPipelineContinuation` is re-entrant for the current owner.

## Surface

Primary: `v2/src/persistence/state-store.ts`. In-scope: `state-store.test.ts`, every complete `StateStore` test double that must forward new members before subspec 01 lands.

## Prerequisites

- Branch-keyed `pipeline_stages` rows and `claimPipelineContinuation` exist.
- Fan-out sibling dispatch and branch-scoped in-memory artifacts landed (`v2/spec/20260803T214753Z-fan-out-concurrent-sibling-dispatch/`).

## Decisions

- Add durable `pipeline_stage_admission` rows keyed by `(pipeline_id, stage_id, branch_key)` — rules out in-memory-only cross-continuation dedup.
- Expose exactly three `StateStore` methods over that table — rules out folding claim semantics into `updateStage` or a single catch-all mutex API.
- Claim is first-writer-wins with an explicit applied/refused outcome — rules out silent overwrite or implicit lock upgrade.
- Load returns an explicit absent outcome when no row exists — rules out conflating “no claim” with “lost claim”.
- Release clears only the caller’s in-flight admission row — rules out pipeline-wide or stage-id-only release keys.
- Deferred to first consumer: claim-holder identity column shape and release timing relative to `running` linkage — pin in subspec 01 when dispatch wiring lands.

## Task checklist

- Add migration `022-pipeline-stage-admission` and `pipeline_stage_admission` table keyed by `(pipeline_id, stage_id, branch_key)`.
- Add three `StateStore` methods: atomic claim, release, and load for `pipeline_stage_admission`.
- Forward the three methods from every complete `StateStore` test double already required to compile dispatch tests.
- Add `state-store.test.ts` coverage: claim applied/refused under contention, release idempotency or refusal semantics as implemented, load absent (no row), and load present after claim.
- Update `v2/docs/state-store.md` with the `pipeline_stage_admission` claim contract.

## Acceptance criteria

- [ ] `state-store.test.ts` — exercises all three `pipeline_stage_admission` methods against real SQL, including the no-row load case; removing the schema or any method makes the regression fail against baseline.
- [ ] `state-store.test.ts` — concurrent claim attempts on the same `(pipelineId, stageId, branchKey)` apply exactly once; inverting the first-writer guard makes the regression fail.
- [ ] `bun run typecheck` and `bun run test:v2` exit zero.

## Documentation updates

- `v2/docs/state-store.md` — `pipeline_stage_admission` table, claim/release/load contract, and how absent rows differ from refused claims.
