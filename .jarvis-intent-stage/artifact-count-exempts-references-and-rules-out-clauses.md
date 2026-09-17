---
name: artifact-count-exempts-references-and-rules-out-clauses
---

# One-artifact bullet check treats rules-out and test-coverage paths as mentions and reports all offenders

Unsplit rationale: every change is to the bullet-artifact validation in `shared/module-boundary-surfaces.ts`, plus its tests and one doc, so the seed has only one module-boundary surface.

## Primary implementation surface

- `shared/module-boundary-surfaces.ts`

## Prerequisites

## Behavior

- Paths inside a rules-out clause (text after `rules out` in the same bullet) count as mentions, not artifacts.
- In an acceptance-criteria bullet, a `*.test.ts` path plus the production paths it exercises counts as one artifact.
- Validation refuses once and names every offending bullet in the tree.
- Bullets that build two or more artifacts ("adds `a.ts` and `b.ts`") are still refused.

## Acceptance criteria

- [ ] A test proves a Decisions bullet naming one built artifact plus paths inside a rules-out clause passes; it fails against the pre-fix check.
- [ ] A test proves an AC bullet naming a `*.test.ts` path plus the production module(s) it covers passes; it fails against the pre-fix check.
- [ ] A test proves a bullet building two artifacts ("adds `a.ts` and `b.ts`") is still refused.
- [ ] A test proves a tree with several offending bullets is refused once, naming all of them.

## Documentation updates

- `v2/docs/spec-guidance.md` — one-artifact rule: what counts as a mention.
