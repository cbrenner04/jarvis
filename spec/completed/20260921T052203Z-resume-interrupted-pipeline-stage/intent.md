---
name: resume-interrupted-pipeline-stage
---

# Operator-killed pipeline stages are resumable

Unsplit rationale: resume admission (`resumeDeferredRefusalApplies`, `reopenFailedPipeline`) live in `v2/src/daemon/pipeline-execution.ts`; one surface.

## Primary implementation surface

- `v2/src/daemon/pipeline-execution.ts`

## Prerequisites

## Behavior

- Derived `interrupted` comes only from stage rows (`derivePipelineState`), so scope is any `interrupted` stage row — from `run kill --force` or orphan reconciliation alike; there is no marker to tell them apart, and none is added.
- `pipeline resume <id> <branch>` reopens an `interrupted` stage and dispatches it, as it does for `failed`.
- Restart continuation does not auto-continue an `interrupted` pipeline: no marker distinguishes an operator `run kill --force` from orphan reconciliation, and auto-continuing would undo a deliberate kill. `isPipelineContinuable` is unchanged; explicit `pipeline resume` is the only path.
- An `interrupted` pipeline carrying an unsettled `running` stage still refuses resume (pinned by `pipeline-execution.test.ts` "resume still refuses an interrupted pipeline carrying an unsettled running stage").
- Refusals name the derived state, the offending stage, and the clearing verb; no bare `pipeline_not_resumable`.
- Dismissed pipelines stay dismissed.

## Acceptance criteria

- [ ] A pipeline test kills a linked run with `--force`, then proves `pipeline resume` reopens and dispatches that stage; it fails against the pre-fix unconditional refusal.
- [ ] A test proves restart continuation (`recoverContinuablePipelines`) still leaves an `interrupted`-stage pipeline undispatched.
- [ ] A test asserts the refusal for an `interrupted` pipeline with an unsettled `running` stage names the derived state, the offending stage, and the clearing verb; it fails against the pre-fix bare `pipeline_not_resumable`.
- [ ] A test proves `pipeline resume` leaves a dismissed `interrupted` pipeline dismissed and undispatched; it is a new test unless an existing dismissal test already pins it.
- [ ] `pipeline-execution.test.ts` "resume still refuses an interrupted pipeline carrying an unsettled running stage" stays green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — line 190: drop `interrupted` from the `pipeline_not_resumable` list; document explicit resume of an `interrupted` stage and that restart continuation does not auto-continue it.
- `v2/docs/operator-runbook.md` — line 741: replace "an `interrupted` pipeline refuses without settling anything" with the new resume behavior.
- `v2/docs/v1-behaviors.md` — add a `[v2 behavior change]` entry beside the `pipeline resume` entry (line 325): `interrupted` stages now resume instead of refusing `pipeline_not_resumable`. v1 had no pipelines.
