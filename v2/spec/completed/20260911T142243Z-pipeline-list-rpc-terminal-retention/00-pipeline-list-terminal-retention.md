# Terminal retention and filtered bypass for `pipeline_list`

## Problem

`pipeline_list` in `v2/src/daemon/daemon-pipeline-handlers.ts` projects `store.listPipelines()` wholesale (minus dismissed rows), so every consumer — CLI, TUI poll loop — receives an unbounded terminal history that grows forever. Run `list` already bounds itself to the 50 newest terminal runs (`v2/src/daemon/daemon-run-lifecycle-handlers.ts`); pipelines have no equivalent.

## Behavior

Default `pipeline_list` returns every pipeline whose derived state is non-terminal (`pending`, `running`, `awaiting-approval`) plus the 50 newest terminal pipelines by durable `createdAt`. Passing `sinceMs` and/or an exact derived-state filter makes the request a history query: the terminal cap does not apply and every matching non-dismissed pipeline is returned newest-first. Dismissal filtering runs first in both modes, so a dismissed pipeline consumes no retention slot and appears only under `includeDismissed: true`.

## Decisions

- Filter dismissed rows before retention and before filtered matching; rules out letting a dismissed row consume a terminal slot, matching run-list order of operations.
- `includeDismissed` alone does not bypass the terminal cap; rules out treating it as a history flag.
- Terminal membership is `isPipelineTerminal(derivePipelineState(pipeline))`; rules out reading the durable `pipelines.status` column, which does not carry derived rejection/interruption semantics.
- Order terminal candidates by `createdAt` descending with `pipelineId` descending as tie break; `listPipelines()` issues an unordered `SELECT`, so the handler must sort rather than trust row order.
- Filter params are `sinceMs` (epoch ms, inclusive on `createdAt`) and `state` (exact `PipelineDerivedState` match), composed conjunctively; presence of either triggers the bypass. Rules out reusing run `list`'s `project`/`branch`/`specPath` fields, which have no pipeline-row equivalent.
- No `limit` param on the filtered path. Deferred to first consumer: a filtered-query row cap — pin when a caller needs it.
- Rank and slice the durable row set before `projectPipelineSnapshot`, so evicted pipelines are never projected.
- Preserve every `pipelines`, `pipeline_stages`, and `pipeline_stage_admission` row; rules out deletion, pruning, or auto-dismissal as the retention mechanism.

## Acceptance criteria

- [x] A regression test in `v2/src/daemon/daemon-pipeline-handlers.test.ts` seeds more than 50 terminal pipelines and proves default `pipeline_list` returns exactly the 50 newest terminals by `createdAt` plus every non-terminal pipeline; it fails against the pre-fix code.
- [x] The default projection includes `pending`, `running`, and `awaiting-approval` pipelines older than every retained terminal, regardless of terminal volume.
- [x] `pipeline_list { sinceMs }` returns a terminal pipeline beyond the default cap when its `createdAt` is greater than or equal to the cutoff, newest-first.
- [x] `pipeline_list { state }` returns matching terminal pipelines beyond the default cap and composes conjunctively with `sinceMs`.
- [x] A pipeline evicted from the default projection is still returned in full by `loadPipeline`, with all durable stages, after both a default and a filtered list request.
- [x] A dismissed terminal pipeline consumes no default retention slot and is returned only under `includeDismissed: true`, in both default and `sinceMs` modes.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — `pipeline_list` row: default 50-terminal retention, always-visible non-terminal states, `sinceMs`/`state` bypass and ordering, dismissal-before-retention order, durable-rows-unchanged invariant.
- `v2/docs/v1-behaviors.md` — `pipeline_list` no longer returns every stored pipeline by default.
