---
name: resume-interrupted-pipeline-stage
---

# Operator-killed pipeline stages are resumable

Unsplit rationale: resume admission (`resumeDeferredRefusalApplies`, `reopenFailedPipeline`) and restart continuation both live in `v2/src/daemon/pipeline-execution.ts`; one surface.

## Primary implementation surface

- `v2/src/daemon/pipeline-execution.ts`

## Prerequisites

## Behavior

- `pipeline resume <id> <branch>` reopens an `interrupted` stage (from `run kill --force`) and dispatches it, as it does for `failed`.
- Restart continuation treats a pipeline whose only non-terminal lane is an `interrupted` stage as continuable.
- Refusals name the derived state, the offending stage, and the clearing verb; no bare `not resumable`.
- Dismissed pipelines stay dismissed.

## Acceptance criteria

- [ ] A pipeline test kills a linked run with `--force`, then proves `pipeline resume` reopens and dispatches that stage; it fails against the pre-fix unconditional refusal.
- [ ] A test proves restart continuation treats a pipeline whose only non-terminal lane is an `interrupted` stage as continuable.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md`, `v2/docs/operator-runbook.md` — killed stages are resumable; retire the "interrupted is a dead end" caveat.
