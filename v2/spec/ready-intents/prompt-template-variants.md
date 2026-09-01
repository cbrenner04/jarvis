---
name: prompt-template-variants
---

# Prompt template variants and optional sections

## Prerequisites

## Primary implementation surface

- Shared prompt template renderer in `shared/prompts/render.ts`

## Problem

- Callers patch rendered prompt text with `.replace` and `stripOptionalSection` because the template renderer cannot select variants or omit empty sections; prose edits silently disable those rewrites.

## Behavior

- The template renderer selects a caller-named entry from artifact frontmatter `variants` (map of variant id → anchor substitutions) and omits sections declared in `optionalSections` (list of `{ header, begin, end, placeholder }` bindings) when the bound placeholder value is empty.
- A variant or section anchor referenced in frontmatter but absent from the template body fails at render time with a named error.

## Decision ledger

- Declare `variants` and `optionalSections` in artifact frontmatter and resolve them inside `renderArtifactTemplate`; rules out post-render string surgery as the extension mechanism.
- Pin variant ids `flat-layout` and `nested-target-dir` for plan-review and plan-draft spec-path substitution; rules out deferring the catalog to `eliminate-prompt-string-surgery`.
- Missing variant or section anchors are hard render errors; rules out silent no-op when prompt prose drifts.

## Acceptance criteria

- [ ] `shared/prompts/render.test.ts` — declared variant referencing a missing template anchor throws at render time; fails against the pre-fix silent no-op behavior.
- [ ] `shared/prompts/render.test.ts` — optional section with an empty bound placeholder value is omitted from rendered output while required sections still render.
- [ ] `bun run typecheck` and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/prompts.md` — `variants` and `optionalSections` frontmatter contract and render-time anchor errors.
