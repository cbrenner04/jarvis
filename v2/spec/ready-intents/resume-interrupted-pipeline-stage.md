---
name: resume-interrupted-pipeline-stage
---

# Operator-killed pipeline stages are resumable

Unsplit rationale: resume admission (`resumeDeferredRefusalApplies`, `reopenFailedPipeline`) and restart continuation both live in `v2/src/daemon/pipeline-execution.ts`; one surface.

## Primary implementation surface

- `v2/src/daemon/pipeline-execution.ts`

## Prerequisites

## Behavior

- Derived `interrupted` comes only from stage rows (`derivePipelineState`), so scope is any `interrupted` stage row — from `run kill --force` or orphan reconciliation alike; there is no marker to tell them apart, and none is added.
- `pipeline resume <id> <branch>` reopens an `interrupted` stage and dispatches it, as it does for `failed`.
- Restart continuation (`isPipelineContinuable`, used by `recoverContinuablePipelines`) admits a pipeline whose derived state is `interrupted` and whose interrupted stage has no unsettled `running` sibling; today it returns `false` for every derived state but `pending`.
- An `interrupted` pipeline carrying an unsettled `running` stage still refuses resume (pinned by `pipeline-execution.test.ts` "resume still refuses an interrupted pipeline carrying an unsettled running stage").
- Refusals name the derived state, the offending stage, and the clearing verb; no bare `pipeline_not_resumable`.
- Dismissed pipelines stay dismissed.

## Acceptance criteria

- [ ] A pipeline test kills a linked run with `--force`, then proves `pipeline resume` reopens and dispatches that stage; it fails against the pre-fix unconditional refusal.
- [ ] A test proves `isPipelineContinuable` admits an `interrupted`-stage pipeline with persisted context, so `recoverContinuablePipelines` continues it; it fails against the pre-fix code, where `isPipelineContinuable` returns `false` for derived `interrupted`.
- [ ] A test asserts the refusal for an `interrupted` pipeline with an unsettled `running` stage names the derived state, the offending stage, and the clearing verb; it fails against the pre-fix bare `pipeline_not_resumable`.
- [ ] A test proves `pipeline resume` and restart continuation leave a dismissed `interrupted` pipeline dismissed and undispatched; it is a new test unless an existing dismissal test already pins both paths.
- [ ] `pipeline-execution.test.ts` "resume still refuses an interrupted pipeline carrying an unsettled running stage" stays green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — line 190: drop `interrupted` from the `pipeline_not_resumable` list; document resume of an `interrupted` stage and restart continuation of it.
- `v2/docs/operator-runbook.md` — line 741: replace "an `interrupted` pipeline refuses without settling anything" with the new resume behavior.
- `v2/docs/v1-behaviors.md` — add a `[v2 behavior change]` entry beside the `pipeline resume` entry (line 325): `interrupted` stages now resume instead of refusing `pipeline_not_resumable`. v1 had no pipelines.
