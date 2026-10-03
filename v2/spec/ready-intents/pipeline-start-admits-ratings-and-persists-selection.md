---
name: pipeline-start-admits-ratings-and-persists-selection
---

# `pipeline start` admits `--risk`/`--effort` and persists the selection it made

## Problem

`jarvis pipeline start` (`v2/src/commands/pipeline-start-admission.ts`) cannot override seed ratings, records nothing about why a pipeline was chosen, and resume or recovery would re-derive selection from seed and config that may have changed.

## Decisions

- `--risk` and `--effort` each override that seed rating independently; an omitted flag uses the seed rating.
- Plan must decide missing-rating behavior when a seed, the flags, and the project minimum all leave a dimension unset (require flags, explicit default, or migrate), and the treatment of inline seed text; a project minimum never silently becomes a default.
- Admission persists the effective ratings, each rating's source (seed, flag, or minimum), and the selected definition on the pipeline row; resume and recovery use the admitted selection, never a re-derivation.
- Selection goes through the canonical project-pipeline resolution boundary shared with future free-text routing; no agent interprets seed prose at launch.

## Prerequisites

- Floors and the pair-to-definition mapping (delivered by: project-minimums-and-rating-pair-select-pipeline)

## Acceptance criteria

- [ ] `pipeline-start-admission.test.ts`: seed-only, each flag alone, both flags, overrides below and above the project floor, malformed and missing values, and distinct pairs each admit or refuse as specified; fails against current code (flags unknown).
- [ ] `pipeline.test.ts`: the admitted ratings, sources, and definition are on the pipeline row and `pipeline list`/status output; a resume after a seed or config edit keeps the admitted definition.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — `--risk`, `--effort`, selection feedback, missing-rating errors or defaults.
- `v2/docs/pipeline-execution.md` — admitted selection and resume/recovery behavior.
- `v2/docs/spec-guidance.md` — seed authoring supplies both ratings; treatment of existing and inline seeds.
- `v2/docs/v1-behaviors.md` — record rating-based selection.

## Primary implementation surface

- `v2/src/commands/pipeline-start-admission.ts`, `v2/src/commands/pipeline.ts`, `v2/src/persistence/state-store.ts`
