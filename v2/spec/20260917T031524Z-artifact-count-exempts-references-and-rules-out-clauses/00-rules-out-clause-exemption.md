# Rules-out clause exemption in the one-artifact bullet check

Paths named inside a bullet's `rules out` clause are mentions, not artifacts, in any section.

## Decisions

- The clause runs from a case-insensitive `rules out` to the end of the bullet, or to an earlier `;` or ` — ` (em dash) in the same bullet, whichever comes first — rules out one bullet's clause swallowing a distinct trailing clause, e.g. a bullet reading "builds a.ts — rules out b.ts; adds c.ts", where the trailing "; adds c.ts" must still count as a build claim on a second artifact.
- Stripping happens inside `referencedArtifactPaths`, before the result reaches `assertSingleArtifactBullets` — rules out gating the exemption on "no build verb elsewhere in the bullet" (as `isStaysUnchangedBullet` does), which would refuse the ordinary "adds a.ts — rules out b.ts" shape since it names a build verb for the artifact actually built.
- Applies regardless of section (Acceptance criteria, Decisions, Documentation updates), matching the intent's section-agnostic framing.

## Acceptance criteria

- [x] A test proves a Decisions bullet naming one built artifact plus paths inside a `rules out` clause passes; it fails against the pre-fix check.
- [x] A test proves a bullet reading "builds a.ts — rules out b.ts; adds c.ts." is still refused for naming two built artifacts (a.ts and c.ts), since b.ts sits only inside the rules-out clause.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2`, `bun run test:integration:v2`, `bun run test:shared`, and `bun run test:integration:shared` pass.

## Documentation updates

- `v2/docs/spec-guidance.md` — one-artifact rule: paths inside a `rules out` clause count as mentions, in any section.
