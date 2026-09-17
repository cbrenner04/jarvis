---
name: artifact-count-exempts-references-and-rules-out-clauses
---

# One-artifact bullet check treats rules-out and test-coverage paths as mentions and reports all offenders

Unsplit rationale: every change is to the bullet-artifact validation in `shared/module-boundary-surfaces.ts`, plus its tests and one doc, so the seed has only one module-boundary surface.

## Primary implementation surface

- `shared/module-boundary-surfaces.ts`

## Prerequisites

## Behavior

- Paths inside a rules-out clause (text after `rules out` in the same bullet) count as mentions, not artifacts, regardless of section.
- In an acceptance-criteria bullet only, a test-file path plus the production path(s) it exercises counts as one artifact. Scoped to AC bullets (not section-agnostic like the rules-out exemption) because only an AC bullet claims a test covers a build; Decisions/Documentation-updates bullets don't make that claim.
- Refusal changes from throw-on-first-offense to collecting every offending bullet across the whole tree and reporting them in one refusal. Bundled into this intent rather than split out: it's the same `assertSingleArtifactBullets`/`normalizePlanDraftSpecDir` loop (`shared/module-boundary-surfaces.ts`) already being touched by the two exemptions above.
- Bullets that build two or more artifacts ("adds `a.ts` and `b.ts`") are still refused.

## Acceptance criteria

- [ ] A test proves a Decisions bullet naming one built artifact plus paths inside a rules-out clause passes; it fails against the pre-fix check.
- [ ] A test proves an AC bullet naming `shared/state.ts` plus the `shared/state.test.ts` that covers it passes — reversing the existing "rejects an acceptance criterion naming two artifact paths with actionable context" case in `shared/module-boundary-surfaces.test.ts`; it fails against the pre-fix check.
- [ ] `shared/module-boundary-surfaces.test.ts`'s two-artifact-without-coverage rejections (e.g. "rejects two artifact paths without module-boundary vocabulary") stay green.
- [ ] A test proves a tree with several offending bullets across multiple files is refused once, naming all of them in a single error; it fails against the pre-fix check, which throws on only the first offender.

## Documentation updates

- `v2/docs/spec-guidance.md` — one-artifact rule: what counts as a mention.
