---
name: pipeline-settlement-derives-from-run-rows
---

# Pipeline settlement derives from durable run rows

## Problem

Stage terminal status and artifacts are copied by daemon wait paths (`applyEntryRunSettlement` in `pipeline-stage-dispatch.ts`), so a terminal entry run can leave its linked stage `running` when no process-local promise delivers the result. Deferred-settlement markers, copy-then-redrive adoption (`adoptAndSettlePipelineStage`), and dual `derivePipelineState` precedence walks are merge-day workarounds for that ownership gap.

## Pending implementation chain

Land in dependency order:

1. [`durable-run-backed-stage-settlement`](../ready-intents/durable-run-backed-stage-settlement.md) — store-owned settlement from terminal entry runs.
2. [`canonical-pipeline-execution-state-and-stage-claims`](../ready-intents/canonical-pipeline-execution-state-and-stage-claims.md) — durable stage claims and one derivation owner.
3. [`daemon-terminal-run-stage-settlement`](../ready-intents/daemon-terminal-run-stage-settlement.md), [`daemon-terminal-run-settlement`](../ready-intents/daemon-terminal-run-settlement.md), [`execution-terminal-run-settlement-invariant`](../ready-intents/execution-terminal-run-settlement-invariant.md) — execution-loop and restart seams.

Absorbs planning for [[operator-killed-pipeline-stage-is-recoverable]] and [[restart-reconciliation-preserves-paused-resumable-runs]].

## Decision ledger

- A durable settlement operation maps a terminal entry run and its workflow rows onto every linked `running` stage idempotently; rules out requiring an in-process promise or caller-supplied rollup.
- Completed runs settle `succeeded` with artifacts rebuilt from the durable entry row, including `prNumber`/`prUrl`; all other terminal rollups settle `failed` with durable failure evidence; rules out event-path and restart-path mappings drifting.
- A non-terminal linked entry run leaves its stage unchanged; rules out replacing deferred markers with premature terminalization.

## Acceptance criteria

- [ ] `state-store.test.ts` — `settles linked running stages from terminal durable entry runs idempotently` fails against the pre-fix promise-backed path and settles completed and non-success terminal rollups without promise input.
- [ ] `state-store.test.ts` — `settled stage artifacts retain durable entry-run publication evidence` fails against the pre-fix path and proves succeeded settlement rebuilds complete `prNumber`/`prUrl` evidence while missing required spec or terminal-publication evidence retains the existing named failure.
- [ ] `state-store.test.ts` — `live linked entry runs receive no terminal stage write`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — retire merge-day copy-then-redrive settlement once landed.
- `v2/docs/state-store.md` — durable settlement contract.
- `v2/docs/daemon-host.md` — restart continuation after settlement restructure.
