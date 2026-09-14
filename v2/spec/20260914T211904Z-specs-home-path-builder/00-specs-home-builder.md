# Specs home builder consolidation

Behavior-preserving: `v2/src/paths.ts` gains `specsHome(projectKey, jarvisRoot?)` (`<jarvisRoot>/specs/<projectSafeId>`) plus root-level `specsRoot(jarvisRoot?)`; every `"specs"` join in `v2/src` consumes them.

## Decisions

- Builders take an optional `jarvisRoot` defaulting to `jarvisHome()`; rules out forcing `jarvisHome()` at call sites already threading an injected root and breaking their fixtures.
- Root-level scans at existing call sites use `specsRoot`, not a per-project builder.
- Structural guard is a `bun:test` file scanning non-test `v2/src/**/*.ts` for a `"specs"` string literal outside `paths.ts`; rules out a lint rule.

## Acceptance criteria

- [ ] `v2/src/paths.ts` exports `specsHome` and `specsRoot`.
- [ ] A structural test greps `v2/src` and fails on any `"specs"` path join outside `paths.ts`.
- [ ] Existing pipeline-stage-resolve, cleanup, and publication/implement workflow-step tests stay green (behavior unchanged).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- None: internal consolidation, layout unchanged.
