---
name: pipeline-stage-stuck-running-after-failed-run
---

# A pipeline stage whose run fails stays `running` forever and the pipeline is unrecoverable

Unsplit rationale: In-band stage settlement, startup/reconciliation sweeps (`continueContinuablePipelines`, `hasRedrivableDeferredSettlement`), and `pipeline_resume` admission for the stuck-`running` wedge all live in the daemon pipeline execution boundary (`pipeline-stage-dispatch`, `pipeline-execution`, daemon startup sweep); persistence, CLI, and workflow execution need no contract change beyond what those paths already call.

## Primary implementation surface

- Daemon — pipeline stage dispatch settlement, continuation/reconciliation sweeps, and `pipeline_resume` admission (`v2/src/daemon/`)

## Prerequisites

## Problem

When a pipeline workflow stage's dispatched run terminates `failed` — for example `quota_exhausted` / `invocation_failure` — the stage record is not settled to `failed`. It stays `status: running`, the pipeline's derived state stays `running`, and there is no recovery path: `jarvis pipeline resume` refuses with `pipeline_not_resumable`, `jarvis pipeline recover` only applies to a `failed` `plan` stage, and killing the already-terminal failed run does not change the stuck stage row.

This is distinct from the existing deferred-settlement path: `running` stages whose `failureDetail.code` is `settlement_deferred` already redrive via `redrivableDeferredSettlementEntryRunId` / `hasRedrivableDeferredSettlement` when the linked run later terminals (see `pipeline-execution.test.ts` restart-sweep tests). The wedge here is `running` with `workflowInvocationId` pointing at a terminally-failed run **without** that marker because in-band settlement never ran.

Observed 2026-08-23 on `full-review` pipeline `96830216`: implement stage run `5d3cb6e8` committed one iteration then terminated `failed` with `outcomeKind: invocation_failure` / `quota_exhausted`; the stage row stayed `running` with `workflowInvocationId: 5d3cb6e8` (no `settlement_deferred`), `pipeline resume … default` returned `pipeline_not_resumable`, and the pipeline was dismissed rather than recovered.

## Decisions

- A pipeline workflow stage whose dispatched run reaches terminal `failed` must settle the stage `failed` with failure detail and linked run so the pipeline derives `failed` and becomes resumable; rules out leaving the stage `running` after its only run has terminally failed.
- When failure arrives out-of-band (the run settles `failed` without the pipeline-execution settlement callback running), reconciliation at existing daemon hooks — daemon-start `continueContinuablePipelines`, resume admission, and extending `hasRedrivableDeferredSettlement` / `redrivableDeferredSettlementEntryRunId` to cover the unsettled wedge — must detect a `running` stage whose `workflowInvocationId` names a terminally-failed run (without `settlement_deferred`) and settle that stage `failed`; rules out relying solely on the in-band settlement callback that a quota abort can skip, and rules out inventing a new periodic reconciliation timer (none exists today).
- Extend `pipeline resume` admission for a `running` stage whose linked run is terminal or absent: admit and replay through the existing failed-continuation path after reconciliation force-settles or admits the wedge; rules out a separate force-settle verb and rules out an unrecoverable pipeline when reconciliation has not yet fired.
- Reconciliation and resume admission must not force-settle a stage whose linked run is genuinely still live; rules out killing in-flight work.

## Acceptance criteria

- [ ] When a pipeline workflow stage's dispatched run terminates `failed` — pinned exemplar `invocation_failure`/`quota_exhausted`, with other terminal `failed` outcomes covered by Decision 1 — the stage settles to `failed` with its failure detail and linked run, and the pipeline derives `failed`; pinned by a daemon/pipeline-execution test that fails a stage run and asserts the stage/pipeline become `failed` (fails against the current code that leaves the stage `running`).
- [ ] After such a failure, `jarvis pipeline resume <id> [<branch>]` reopens and replays the failed stage instead of returning `pipeline_not_resumable` — pinned by a test.
- [ ] Daemon-start `continueContinuablePipelines` and/or extended `hasRedrivableDeferredSettlement` settle a stage still `running` whose `workflowInvocationId` names a terminally-failed run without `settlement_deferred` to `failed` — pinned by a reconciliation test seeding that inconsistent pair.
- [ ] A stage whose linked run is genuinely live is never force-settled by reconciliation or resume admission — pinned by a test; reachable on the base via live-linkage / adopt-and-settle guards in `pipeline-stage-dispatch.ts` and completed `stage-entry-run-linkage` specs.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — recovery section: a stage whose run fails (including quota) now settles `failed` and is recoverable via `pipeline resume`; note the daemon-start / resume-admission reconciliation backstop; remove any implication that a mid-stage failure strands the pipeline.
- `v2/docs/daemon-host.md` — pipeline stage failure settlement, the unsettled wedge (`running` + terminally-failed linked run without `settlement_deferred`), and reconciliation via `continueContinuablePipelines` / `hasRedrivableDeferredSettlement`.
- `v2/docs/v1-behaviors.md` — record settled-failed stage rows and resume/reconciliation recovery for the stuck-`running` wedge in the v2 parity baseline.
