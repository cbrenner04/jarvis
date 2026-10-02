---
name: pipeline-selection-risk-effort
---

# Select pipelines from seed risk and effort, with project minimums

## Problem

Pipeline selection currently comes from `projects.<key>.pipeline.name`, so a project's seeds receive the same named pipeline regardless of their risk or effort. The operator should describe the work along those two dimensions and let Jarvis choose the pipeline deterministically, while project configuration can impose minimum ratings.

## Decisions

- Seeds carry separate `risk` and `effort` ratings in frontmatter. Risk describes the consequences and uncertainty of getting the change wrong; effort describes the expected amount or complexity of work. Neither substitutes for the other.
- `jarvis pipeline start` accepts `--risk` and `--effort`. Each supplied flag overrides that seed rating independently; an omitted flag uses the corresponding seed rating.
- Project configuration supports optional minimum risk and minimum effort ratings alongside the project's existing pipeline configuration. These are floors, not defaults: neither seed metadata nor CLI flags can lower the effective rating below the project's minimum.
- Resolve each dimension independently: `effective = max(project minimum, CLI override or seed rating)` using the chosen rating scale. Validate supplied values before applying floors; malformed ratings must not silently become a valid minimum.
- Select the pipeline through one deterministic mapping from the effective risk/effort pair. Keep the dimensions separate; do not collapse them into a score that hides high risk behind low effort or vice versa. Define the scale and mapping during planning rather than inventing a mapping implicitly at runtime.
- Reuse the canonical project-pipeline resolution/admission boundary for CLI and other callers, including future free-text routing. Pipeline selection must not depend on an agent interpreting seed prose at launch.
- Persist the admitted ratings, their sources, and the selected pipeline definition so the operator can see why it was chosen. Resume/recovery uses the admitted selection rather than silently changing the pipeline after seed or config edits.
- Seed authoring guidance and seed-producing workflows must supply both ratings once the scale is defined. Handle existing unrated seeds and inline seed text explicitly during planning.
- Define how rating-based selection replaces or coexists with `pipeline.name`; avoid competing selectors with unclear precedence. Preserve the separate purpose of terminal action, supersede policy, and review overrides, and validate their compatibility with the selected definition.

## Open questions

- Rating scale and concise examples for each risk/effort level.
- Mapping of rating pairs to existing or new source-owned pipeline definitions, including high-risk/low-effort and low-risk/high-effort work.
- Exact project config keys, compatibility with `pipeline.name`, and migration behavior for existing configurations.
- Missing-rating behavior for existing seeds and inline seed text: require flags, use explicit defaults, or migrate metadata. Project minimums must not accidentally become undocumented defaults.
- Whether existing review overrides can weaken the guarantees intended by a project's risk/effort floors; define the compatibility rules explicitly.

## Acceptance criteria

- [ ] Seed metadata and the two CLI flags resolve independently, with project minimums applied after per-dimension overrides.
- [ ] Tests cover seed-only selection, each flag independently, both flags, lower and higher overrides relative to project floors, malformed/missing values, and distinct risk/effort combinations.
- [ ] The selection mapping and config compatibility rules are explicit and tested; invalid selection fails before pipeline execution.
- [ ] Admission records explain the effective ratings and chosen pipeline; resume/recovery preserves the admitted selection.
- [ ] Seed authoring guidance and affected authoring workflows emit the chosen rating format, with documented treatment of existing and inline seeds.
- [ ] Implementation specs name typecheck and the additive test scopes required by their actual changed surfaces.

## Documentation updates

- `v2/docs/install-and-config.md` — project minimums, selection mapping, precedence, and migration from named pipeline selection.
- `v2/docs/operator-runbook.md` — `--risk`, `--effort`, selection feedback, and missing-rating errors or defaults.
- `v2/docs/spec-guidance.md` and affected seed-authoring prompts — rating definitions, frontmatter, and examples.
- `v2/docs/pipeline-execution.md` — admitted selection and resume/recovery behavior.
