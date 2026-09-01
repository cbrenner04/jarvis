# Prompts doc contract for variants and optionalSections

**Implement scope:** this subspec supersedes `intent.md` for tasks, acceptance criteria, and documentation updates in this slice.

## Problem

`v2/docs/prompts.md` documents placeholder and delimiter contracts but not `variants`, `optionalSections`, or render-time anchor errors. Operators and prompt authors have no durable home for the frontmatter shape or failure modes.

## Decisions

- Document the frontmatter contract, registry load-time validation, render pipeline order, excision semantics, and `PromptRenderingError` reasons in `v2/docs/prompts.md` — rules out duplicating the full contract in `v1/docs/prompt-governance.md` (cross-link only if governance already indexes frontmatter keys).
- Record reserved variant ids `flat-layout` and `nested-target-dir` as the plan-draft/plan-review spec-path catalog for `eliminate-prompt-string-surgery` — rules out deferring the id list to the migration spec.
- Do not update `v2/docs/v1-behaviors.md` — renderer capability is additive and no committed prompt artifact adopts the new frontmatter in this spec; rules out catalog churn before call-site migration changes operator-visible output.

## Tasks

- Add a `variants` and `optionalSections` section to `v2/docs/prompts.md` covering JSON frontmatter encoding, metadata shapes, registry load-time structural rejects, optional-section `placeholder` must be declared in `placeholders`, the `renderArtifactTemplate` `options.variant` selector (omitted = no substitutions), variant `replaceAll` default and sequential application order, empty/`null`/whitespace omission semantics, excision span (`header` through `end` plus trailing newlines; `begin` as positional validator), resolution on caller-supplied `artifact.body`, and `unknown_variant` / `missing_template_anchor` failures.
- List reserved variant ids `flat-layout` and `nested-target-dir` with a pointer to `eliminate-prompt-string-surgery` for migration scope.

## Acceptance criteria

- [x] `v2/docs/prompts.md` documents `variants` and `optionalSections` frontmatter, registry load-time validation, reserved plan variant ids, excision and variant render semantics, and render-time anchor errors.
- [x] `bun run typecheck` and `bun run test:shared` pass after all subspecs in this spec land.

## Documentation updates

- `v2/docs/prompts.md` — `variants` and `optionalSections` frontmatter contract and render-time anchor errors.
