---
name: glob-patterns-are-not-artifact-paths
---

# Glob patterns are not artifact paths

Unsplit rationale: The fix changes one plan-draft normalization surface; its tests and durable docs define the same behavior.

## Problem

The one-artifact-per-bullet gate counts a backticked glob as a concrete artifact, so a sound bullet naming a file convention and one example file is refused as a two-artifact build claim.

## Primary implementation surface

- Plan-draft normalization artifact reference parsing in `shared/module-boundary-surfaces.ts`.

## Decisions

- `referencedArtifactPaths` excludes backticked tokens containing `*`, `?`, or a bracketed glob class because they name file classes rather than concrete artifacts.
- The shared parser changes so every governed section receives the same behavior without another wording-based exemption.
- Concrete path recognition remains narrow, and two concrete files still trigger the existing refusal and message.

## Acceptance criteria

- [ ] A regression test that fails on the pre-fix code proves a Decisions bullet naming `*.sandbox-unrunnable.test.ts` beside one concrete example is accepted.
- [ ] A regression test that fails on the pre-fix code proves a bullet naming only `*.sandbox-unrunnable.test.ts` is accepted.
- [ ] Regression coverage proves `?` and bracketed character-class glob forms are excluded from referenced artifacts.
- [ ] Regression coverage proves `## Documentation updates` uses the same glob handling.
- [ ] Existing coverage proves a bullet naming two concrete files still refuses with the existing diagnostic.
- [ ] `bun run typecheck`, `bun run test:shared`, and `bun run test:integration:shared` pass.

## Documentation updates

- `v2/docs/spec-guidance.md` states that a glob names a convention rather than an artifact and may accompany the concrete artifact a bullet builds.
- `v2/docs/v1-behaviors.md` records the narrowed artifact-path parse.

## Prerequisites
