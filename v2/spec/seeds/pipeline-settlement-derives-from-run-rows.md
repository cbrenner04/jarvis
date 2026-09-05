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

## Evidence: entry-row-only PR lookup fails a published stage (2026-09-05)

Pipeline `d30dbfd3` (`full-review` on `pipeline-resume-echoes-pipeline-id-on-success`) wedged its implement stage `running` with the documented `settlement_deferred` / `entry_run_still_live` marker while every run row on the branch was durably terminal. `jarvis pipeline resume` re-drove it as designed and settled the stage **`failed`** with:

```text
completion_publication_missing_pr_evidence: completion publication left no confirmed PR evidence
on linked entry run fcae02c4-d22e-4e7d-9013-e1bcc40786ea
```

PR #3475 existed, open and non-draft, on that stage's branch. The evidence was simply on a different row: `jarvis run list --branch` shows `prNumber: 3475` on **`da9e1262`**, while the stage's `workflowInvocationId` — and therefore the evidence lookup — pointed at the entry run `fcae02c4`, which carries none. Publication dispatches late under its own run id (already documented in the operator runbook), and settlement does not follow it there.

Consequence: a pipeline reports `failed` over complete, published, gate-green work, and terminal publication is skipped, so the stage never reaches its `ready` terminal action. This is the brief's opening class — terminal state written on the happy path only — reached through the settlement copy rather than the run loop.

Note this refutes the obvious fix: rebuilding the artifact "from the durable entry row" reproduces the failure exactly. The lookup has to span the invocation's rows.

## Decision ledger

- A durable settlement operation maps a terminal entry run and its workflow rows onto every linked `running` stage idempotently; rules out requiring an in-process promise or caller-supplied rollup.
- Completed runs settle `succeeded` with artifacts rebuilt from the durable rows of the whole **invocation** — resolving `prNumber`/`prUrl` from whichever row published them, not the entry row alone; all other terminal rollups settle `failed` with durable failure evidence; rules out event-path and restart-path mappings drifting, and rules out reading PR evidence off the entry row only (see Evidence below).
- A non-terminal linked entry run leaves its stage unchanged; rules out replacing deferred markers with premature terminalization.

## Acceptance criteria

- [ ] A settlement test proves a stage whose entry run carries no `prNumber` but whose sibling publication row does settles `succeeded` with that `prNumber`/`prUrl` on the stage artifact; it fails against entry-row-only evidence lookup (reproduces pipeline `d30dbfd3`).

- [ ] `state-store.test.ts` — `settles linked running stages from terminal durable entry runs idempotently` fails against the pre-fix promise-backed path and settles completed and non-success terminal rollups without promise input.
- [ ] `state-store.test.ts` — `settled stage artifacts retain durable entry-run publication evidence` fails against the pre-fix path and proves succeeded settlement rebuilds complete `prNumber`/`prUrl` evidence while missing required spec or terminal-publication evidence retains the existing named failure.
- [ ] `state-store.test.ts` — `live linked entry runs receive no terminal stage write`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — retire merge-day copy-then-redrive settlement once landed.
- `v2/docs/state-store.md` — durable settlement contract.
- `v2/docs/daemon-host.md` — restart continuation after settlement restructure.
