# Durable `supersedeFailures` on the pipeline row

## Problem

Terminal supersede settlement must record per-PR GitHub failures without clearing `terminalPublicationSucceededAt` or derived `succeeded`; nothing on the pipeline row carries that evidence today.

## Decisions

- Persist `supersedeFailures` as a JSON array column on `pipelines`, `null` when unset — rules out embedding failures inside `terminalPublicationFailure`, which would imply terminal publication failed.
- Element shape `{ prNumber: number; message: string }` only — rules out storing `stageId` or `prUrl` in durable failures when the intent names only those fields.
- Expose `appendSupersedeFailures({ pipelineId, failures })` that concatenates onto the loaded array (or starts from `[]` when `null`) in one transaction — rules out a separate failures table or per-PR rows.

## Tasks

- [x] Extend `Pipeline` in `state-store.ts` with `supersedeFailures: PipelineSupersedeFailure[] | null`; add `supersede_failures TEXT` to the baseline `CREATE TABLE pipelines` and via `addColumnIfMissing` (no new `_migrations` id), include in `PIPELINE_COLUMNS` / `mapPipelineRow`.
- [x] Implement `appendSupersedeFailures` on `StateStore` and wire through the store interface used by daemon tests.
- [x] Add `state-store.test.ts` coverage: append after terminal success leaves `terminalPublicationSucceededAt` intact; second append preserves prior entries; idempotent empty append is a no-op.

## Acceptance criteria

- [x] `state-store.test.ts` fails against the pre-fix baseline and pins `appendSupersedeFailures` concatenation on the pipeline row without clearing `terminalPublicationSucceededAt`.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- [x] `v2/docs/state-store.md` — `supersedeFailures` column, append semantics, and cross-link to terminal supersede settlement in `pipeline-execution.md`.
