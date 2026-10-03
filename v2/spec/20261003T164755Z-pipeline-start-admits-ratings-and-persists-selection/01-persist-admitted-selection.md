# 01 — Persist admitted pipeline selection

## Problem

Daemon `pipeline_start` persists `definition` and `context` but not effective ratings, per-dimension sources, or whether selection was rating-driven — so observation and continuation cannot explain or trust the admitted mapping after seed or config drift.

## Decisions

- Add a durable `admittedSelection` field on the pipeline row (nullable JSON column or equivalent store shape): when rating selection applied at start, record `effective` (`risk`/`effort` levels), `sources` (`seed` | `flag` | `minimum` per dimension), and `registryName` (the selected definition's `name`); when `pipeline.name` selected outright, persist `null` — rules out inferring sources later from `definition.name` alone or omitting the field for rating-selected rows.
- `pipeline_start` RPC carries `admittedSelection` beside `definition` and `context`; `createPipeline` writes definition, context, and selection in one transaction — rules out a second RPC or recomputing selection inside the daemon handler.
- Pre-migration rows and tests that omit the field load as `admittedSelection: null`; execution already uses the stored `definition` snapshot — rules out backfilling historical rows from seed text.
- `admitPipelineStart` forwards the metadata from resolution into `pipeline_start` params — rules out the daemon re-reading seed frontmatter from `context`.

## Task checklist

- Extend `Pipeline` type, SQL schema/migration, `createPipeline`, and loaders for `admittedSelection`.
- Validate RPC `admittedSelection` shape in `daemon-pipeline-handlers.ts` (reject malformed payloads with `invalid_params` before row insert).
- Thread metadata from `admitPipelineStart` through the `pipeline_start` request params.
- Add focused `state-store.test.ts` coverage that admitted selection round-trips with definition and context.

## Acceptance criteria

- [x] `state-store.test.ts` proves `createPipeline` persists and `loadPipeline` returns `admittedSelection` with effective ratings, per-dimension sources, and `registryName` equal to the admitted `definition.name` for a rating-selected fixture, and `null` for a name-selected fixture; fails against the pre-fix schema (column absent).
- [x] `pipeline-start-admission.test.ts` asserts the admitted `pipeline_start` params include `admittedSelection` matching resolution output (including `registryName` === `definition.name`) for at least one rating-selected start; fails pre-fix.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- Deferred to [03 — Operator and spec documentation](./03-operator-and-spec-docs.md).
