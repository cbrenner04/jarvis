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

- The template renderer selects declared variants (for example flat-layout path substitution) and omits optional sections when their bound values are empty.
- A variant or section anchor referenced in frontmatter but absent from the template body fails at render time with a named error.

## Decision ledger

- Declare variants and optional sections in artifact frontmatter and resolve them inside `renderArtifactTemplate`; rules out post-render string surgery as the extension mechanism.
- Missing variant or section anchors are hard render errors; rules out silent no-op when prompt prose drifts.
- Deferred to first consumer: exact frontmatter field names and variant catalog for plan-draft flat layout and implement actuator section omission — pin when a caller needs it.

## Acceptance criteria

- [ ] A regression test in `shared/prompts/render.test.ts` proves a declared variant referencing a missing template anchor throws at render time; it fails against the pre-fix silent no-op behavior.
- [ ] A regression test in `shared/prompts/render.test.ts` proves an optional section with an empty bound value is omitted from rendered output while required sections still render.
- [ ] `bun run typecheck` and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/prompts.md` — template variant and optional-section frontmatter contract and render-time anchor errors.
