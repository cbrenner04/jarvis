---
name: project-minimums-and-rating-pair-select-pipeline
---

# Project minimums floor the ratings and one deterministic mapping selects the pipeline

## Problem

`projects.<key>.pipeline.name` (`v2/src/execution/project-pipeline-resolution.ts`) gives every seed in a project the same pipeline regardless of risk or effort, and a project cannot impose a floor.

## Decisions

- Project config gains optional minimum risk and minimum effort ratings beside the existing pipeline config; they are floors, not defaults: neither seed metadata nor CLI flags lower the effective rating below them. Plan must decide the key names.
- Each dimension resolves independently: `effective = max(project minimum, CLI override or seed rating)`; values are validated before floors apply so a malformed rating never becomes a valid minimum.
- One deterministic mapping from the effective (risk, effort) pair selects a source-owned pipeline definition; the dimensions are never collapsed into a score. Plan must decide the mapping table, including high-risk/low-effort and low-risk/high-effort cells.
- Plan must decide how rating selection replaces or coexists with `pipeline.name` (one precedence rule, no competing selectors) and migration for existing configs.
- Terminal action, supersede policy, and review overrides keep their separate purpose and are validated for compatibility with the selected definition; plan must decide whether review overrides may weaken a project floor.

## Prerequisites

- The rating scale and parsed seed ratings (delivered by: seed-frontmatter-carries-risk-and-effort)

## Acceptance criteria

- [x] `project-pipeline-resolution.test.ts`: minimums parse and validate; a seed rating below the floor resolves to the floor and one above it keeps its value, per dimension; an invalid minimum is a named config error; fails against current code.
- [x] Same file: each defined pair maps to one definition and an undefined pair fails before execution; the `pipeline.name` precedence rule is pinned.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — project minimums, the selection mapping, precedence with `pipeline.name`, migration.

## Primary implementation surface

- `v2/src/execution/project-pipeline-resolution.ts`, `v2/src/config/machine-config-loader.ts`
