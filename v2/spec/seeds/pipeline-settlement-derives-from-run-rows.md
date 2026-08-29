---
name: pipeline-settlement-derives-from-run-rows
---

# Stage settlement derives from durable run rows instead of copy-then-redrive

## Problem

A pipeline stage row is a second, hand-maintained durable copy of its entry run's status, settled by awaiting an in-process promise (`workflowPromisesByEntryRunId`, `daemon.ts:1034`). Every path without that promise — cross-process adoption, daemon restart, quota kill — wedges the row at `running`, and the escape hatches have accreted instead of fixing the design: the `settlement_deferred` marker (`pipeline-stage-dispatch.ts:68-85`), resume-driven redrive (#3012), daemon-start redrive (#3010), terminal-failed widening (#3046), and the open PR-evidence loss ([[deferred-settlement-resume-preserves-pr-evidence]]). Settlement was ~24 of 237 fix commits since 2026-07-15, plus most of the least-recoverable operator wedges.

Adjacent duplication that must go with it (2026-08-29 review, seams S2/S3):

- Two mutual-exclusion mechanisms for one stage row: durable `pipeline_stage_admission` claims (dispatch/recovery) vs process-local promise claims (adoption, `pipeline-execution.ts:1572`), so cross-process adoption is unguarded.
- "Is this stage/pipeline in flight?" has ~6 independent implementations, and `derivePipelineState` is two full copies (linear walk `pipeline-execution.ts:2233-2258`, fan-out aggregation `:2110-2222`) that must agree on ordering rules by hand.

## Decisions

- Stage terminal status is derived from (or transactionally written with) the entry run's durable row by one settlement owner that runs on run-terminal events and on daemon start; the in-process promise becomes a latency optimization, never the source of truth. Rules out any path where a terminal run leaves a `running` stage.
- The `settlement_deferred` marker and both redrive paths are retired once the single owner covers their cases. Rules out keeping copy-then-reconcile alongside derive.
- One stage-claim mechanism (the durable one) guards dispatch, adoption, and recovery. Rules out the unguarded process-local adoption claim.
- One `derivePipelineState` implementation serves linear and fan-out shapes; the in-flight predicates collapse onto it. Rules out two hand-synced ordering copies.
- Settled artifacts carry publication evidence (`prNumber`/`prUrl`) as part of the derived settlement, subsuming the point fix in [[deferred-settlement-resume-preserves-pr-evidence]] once that lands. Rules out evidence living only on the happy in-band path.

## Acceptance criteria

- [ ] A stage whose entry run reaches any terminal status settles identically whether the daemon held the run's promise, adopted it, or restarted after it — pinned by tests driving all three paths to the same row state (the promise-less paths fail today).
- [ ] No `settlement_deferred` marker is written on any covered path; the redrive predicates are deleted — pinned by grep-level absence plus behavior tests.
- [ ] Adoption of an already-dispatched stage is refused by the durable claim, pinned by a test that fails against the process-local claim.
- [ ] Linear and fan-out pipelines derive state through one implementation, pinned by existing derivation tests re-pointed at it (no assertion dropped).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — settlement ownership, run-terminal + start-time coverage, retired redrive paths.
- `v2/docs/operator-runbook.md` — remove deferred-settlement recovery choreography once retired.
