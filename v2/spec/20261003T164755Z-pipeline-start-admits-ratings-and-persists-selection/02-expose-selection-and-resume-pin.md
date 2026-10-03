# 02 — Expose admitted selection and pin resume on the durable row

## Problem

Continuation already runs from the stored `definition` snapshot; operators still cannot see admitted ratings/sources, and no regression proves resume, `pipeline recover`, or `recoverContinuablePipelines` never re-resolve pipeline choice from live seed or project config after admit.

## Decisions

- Extend `PipelineSnapshot` (and `pipeline_list` projection) with optional `admittedSelection` mirroring the durable row; human `pipeline list` adds a compact ratings/sources column only when selection is non-null — rules out re-parsing seed paths at list time or hiding rating metadata in JSON-only output.
- On successful `pipeline start`, print one stderr line summarizing effective `risk`/`effort`, sources, and selected registry name when rating-selected; omit the line for explicit `pipeline.name` starts — rules out changing the stdout pipeline-id contract.
- `pipeline resume`, `pipeline recover`, and `recoverContinuablePipelines` continue from `loadPipeline(...).definition`, persisted context, and `admittedSelection` only — never call `resolveProjectPipeline` (or equivalent) on post-admit seed/config (reachable today: execution paths do not import resolution; a post-admit mutation that would select a different registry name under live resolution must not change the row's `definition.name` or `admittedSelection`).
- Deferred to first consumer: TUI pipeline tree labels for admitted ratings — pin when monitor snapshots expose the new snapshot field.

## Task checklist

- Project `admittedSelection` in `pipeline-observation.ts` snapshot builder and CLI list/json formatters.
- Add stderr selection feedback in `runPipelineStartCommand` after admission.
- Add `pipeline.test.ts` integration coverage: admitted row carries definition + selection; list output exposes them; post-admit mutations to `projects.<key>.pipeline` and seed bytes; `pipeline resume` and at least one of `pipeline recover` or `recoverContinuablePipelines` (whichever the harness exercises) each assert unchanged `definition.name` and `admittedSelection` while continuation proceeds or refuses for unrelated reasons.

## Acceptance criteria

- [x] `pipeline.test.ts` proves the durable pipeline row after `pipeline start` includes the admitted definition, effective ratings, and sources, and that human or JSON `pipeline list` surfaces them; fails pre-fix.
- [x] `pipeline.test.ts` proves rating-selected `pipeline start` prints one stderr line with effective `risk`/`effort`, per-dimension sources, and selected registry name; fails pre-fix (no summary).
- [x] `pipeline.test.ts` proves `pipeline resume` after mutating `projects.<key>.pipeline` and the admitted seed file so live `resolveProjectPipeline` would pick a different registry name still continues from the row's `definition.name` and `admittedSelection`; fails pre-fix if continuation reintroduces resolution (definition-only equality would not catch a swapped definition with stale selection).
- [x] `pipeline.test.ts` proves `pipeline recover` or daemon `recoverContinuablePipelines` (named path in the test) after the same post-admit mutations keeps `definition.name` and `admittedSelection` unchanged; fails pre-fix if recovery reintroduces resolution.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- Deferred to [03 — Operator and spec documentation](./03-operator-and-spec-docs.md).
