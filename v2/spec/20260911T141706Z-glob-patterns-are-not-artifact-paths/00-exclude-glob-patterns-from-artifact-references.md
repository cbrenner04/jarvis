# Exclude glob patterns from artifact references

## Problem

Plan-draft normalization counts a backticked glob as a concrete artifact, so a bullet naming a file convention beside one example file is refused as a multi-artifact claim.

## Decisions

- Exclude matched backticked tokens containing `*`, `?`, or a bracketed character class from referenced artifacts; rules out counting file classes as concrete deliverables.
- Classify glob syntax in the shared artifact-reference extractor before governed sections are evaluated; rules out section-specific or wording-based exemptions.
- Preserve narrow concrete-path recognition and the current two-concrete-artifact diagnostic; rules out broadening or replacing the existing parser contract.

## Tasks

- [ ] Update `shared/module-boundary-surfaces.ts` to exclude glob patterns from referenced artifact paths.
- [ ] Add focused regression and preservation coverage in `shared/module-boundary-surfaces.test.ts`.
- [ ] Clarify the authoring rule in `v2/docs/spec-guidance.md`.
- [ ] Record the changed normalization behavior in `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] Regression cases in `shared/module-boundary-surfaces.test.ts` fail against the pre-fix code and prove that a Decisions bullet naming "*.sandbox-unrunnable.test.ts" beside one concrete example is accepted.
- [ ] A regression case in `shared/module-boundary-surfaces.test.ts` fails against the pre-fix code and proves `referencedArtifactPaths` excludes a bullet naming only `*.sandbox-unrunnable.test.ts`.
- [ ] Regression cases in `shared/module-boundary-surfaces.test.ts` prove question-mark and bracketed-character-class glob forms are excluded from referenced artifacts.
- [ ] Regression cases in `shared/module-boundary-surfaces.test.ts` prove `## Documentation updates` receives the same glob handling as `## Decisions` and `## Acceptance criteria`.
- [ ] Existing two-concrete-file refusal cases in `shared/module-boundary-surfaces.test.ts` stay green with the existing diagnostic.
- [ ] A regression case in `shared/module-boundary-surfaces.test.ts` proves a glob beside two concrete paths still refuses with the existing diagnostic.
- [ ] `v2/docs/spec-guidance.md` states that a glob names a convention rather than an artifact and may accompany the concrete artifact a bullet builds.
- [ ] `v2/docs/v1-behaviors.md` records the narrowed artifact-path parse.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2`, `bun run test:integration:v2`, `bun run test:shared`, and `bun run test:integration:shared` pass.

## Documentation updates

- Update `v2/docs/spec-guidance.md` with the glob-convention rule.
- Update `v2/docs/v1-behaviors.md` with the narrowed artifact-path parse.
