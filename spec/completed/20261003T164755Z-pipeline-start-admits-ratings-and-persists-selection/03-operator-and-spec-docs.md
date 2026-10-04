# 03 — Operator and spec documentation

## Problem

Operators and spec authors lack documented `--risk`/`--effort` behavior, admission feedback, missing-rating errors, durable selection, and resume semantics aligned with the implementation.

## Decisions

- Document missing-rating refusal as unresolved per dimension (seed and/or flags required; minimums are floors) consistently across runbook, pipeline execution, and spec guidance — rules out documenting minimums as defaults.
- Spec guidance requires both `risk:` and `effort:` in new seed frontmatter examples; note that legacy seeds without ratings must supply flags at `pipeline start` until migrated — rules out claiming parsing alone satisfies admission.

## Task checklist

- Update `v2/docs/operator-runbook.md` with `--risk`, `--effort`, stderr selection summary, and missing-rating errors.
- Update `v2/docs/pipeline-execution.md` with persisted `admittedSelection`, list exposure, and resume/recovery using the admitted row only.
- Update `v2/docs/spec-guidance.md` seed ratings section for dual ratings, inline seeds, and flag overrides.
- Add a `[v2 additive]` bullet to `v2/docs/v1-behaviors.md` for rating-based pipeline selection at start with Sources.

## Acceptance criteria

- [x] `v2/docs/operator-runbook.md` documents `--risk` and `--effort`, admission selection feedback, and unresolved-rating refusal when neither seed nor flag supplies a dimension.
- [x] `v2/docs/pipeline-execution.md` documents durable `admittedSelection`, list visibility, and that resume/recovery do not re-derive pipeline definition from seed or config.
- [x] `v2/docs/spec-guidance.md` states seeds should carry both ratings, describes inline seed treatment, and covers existing unrated seeds plus CLI flags.
- [x] `v2/docs/v1-behaviors.md` records rating-based selection at `pipeline start` with Sources citing admission and persistence paths.

## Documentation updates

- `v2/docs/operator-runbook.md`
- `v2/docs/pipeline-execution.md`
- `v2/docs/spec-guidance.md`
- `v2/docs/v1-behaviors.md`
