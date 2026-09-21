# Dismissed interrupted pipeline stays dismissed

Today a dismissed `interrupted` pipeline is refused only because derived `interrupted` is refused. Once resume reopens `interrupted` stages, it would reopen and dispatch a dismissed pipeline. Add an explicit guard.

## Touched surfaces

- `v2/src/daemon/pipeline-execution.ts` — `resumePipeline`.

## Decisions

- The guard lives in `resumePipeline` (not the RPC handler) so whole-pipeline and branch-scoped paths share it, and runs before any reopen or dispatch.
- The guard applies only when the resume would reopen an `interrupted` stage (derived `interrupted` whole-pipeline, or `interrupted` branch-admission kind); refusal behavior for other dismissed pipelines is unchanged.
- Refusal reason is a new named `pipeline_dismissed`; a dismissed pipeline is left byte-identical (no reopen, no settlement).

## Acceptance criteria

- [x] A test proves `pipeline resume` on a dismissed `interrupted` pipeline refuses `pipeline_dismissed`, leaves stage rows unchanged, stays dismissed, and dispatches nothing; it fails against the reopen from the interrupted-reopen subspec without the guard.
- [x] A test proves the same for branch-scoped `pipeline resume <id> <branch>` on a dismissed pipeline with an `interrupted` branch stage; it fails without the guard.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — add `pipeline_dismissed` to the resume refusal list: a dismissed `interrupted` pipeline stays dismissed until `pipeline undismiss`.
