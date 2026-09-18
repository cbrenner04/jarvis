---
name: interrupted-pipeline-stage-cannot-be-resumed
---

# An operator-killed pipeline stage settles `interrupted`, which no verb can reopen

## Problem

`run kill --force` on a pipeline-linked run settles its stage `interrupted`. `resumeDeferredRefusalApplies` (`v2/src/daemon/pipeline-execution.ts`, ~:227) refuses a derived `interrupted` state unconditionally, `reopenFailedPipeline` handles only `failed`, and restart continuation requires derived `pending`, so one `interrupted` row parks the pipeline forever. Issue #2996. The settlement seam that was supposed to absorb this closed (#3745) without changing it; verified unchanged on `main` 2026-09-11 and 2026-09-18.

## Decisions

- An operator-killed stage is reopenable: `pipeline resume <id> <branch>` admits an `interrupted` stage the same way it admits a `failed` one, and restart continuation is not poisoned by a single `interrupted` row. Rules out a kill being terminal for the whole pipeline.
- Refusals name the derived state, the offending stage, and the verb that would clear it. Rules out a bare `not resumable`.
- Dismissed pipelines stay dismissed. Rules out reopening rows the operator shed.

## Acceptance criteria

- [ ] A pipeline test kills a linked run with `--force`, then proves `pipeline resume` reopens that stage and dispatches it; it fails against the pre-fix unconditional refusal.
- [ ] A test proves restart continuation treats a pipeline whose only non-terminal lane is an `interrupted` stage as continuable.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md`, `v2/docs/operator-runbook.md` — killed stages are resumable; retire the "interrupted is a dead end" caveat.
