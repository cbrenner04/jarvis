# Documentation-updates leading-path exemption

In a `## Documentation updates` bullet, the leading artifact path is the artifact; any other path is a mention, unless it is itself a markdown path.

## Decisions

- The leading path is the first entry `referencedArtifactPaths` returns for the bullet (left-to-right occurrence order, after existing glob/scaffolding/bare-suffix filtering) — later entries are mentions.
- A later path that is itself a markdown path still counts as a distinct artifact — rules out a bullet claiming two doc files change while calling the second one a mention.
- Scoped to `## Documentation updates` bullets only.

## Acceptance criteria

- [x] A test proves a Documentation updates bullet naming `v2/docs/test-writing.md` plus a test-file path it describes passes; it fails against the pre-fix check.
- [x] A test proves a Documentation updates bullet naming two doc paths is still refused.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2`, `bun run test:integration:v2`, `bun run test:shared`, and `bun run test:integration:shared` pass.

## Documentation updates

- `v2/docs/spec-guidance.md` — one-artifact rule: a Documentation-updates bullet's leading path is the artifact; a later markdown path still counts as a second artifact.
