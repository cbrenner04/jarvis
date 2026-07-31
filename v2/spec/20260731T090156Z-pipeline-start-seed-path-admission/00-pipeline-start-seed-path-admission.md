# Pipeline start seed path admission

## Problem

`pipeline start --seed <path>` reads the file at admission and stores its contents in
`PipelineContext.seed`, so downstream intent resolution cannot use the path branch of
`resolveSeed` in `publication-workflow-steps.ts`.

## Decisions

- `resolvePipelineSeed` validates relative path, existence, is-file, and containment under `projects.<projectKey>.root` (registered root for the `<project>` argument, not invocation `cwd` or a cwd-matched project) after symlink resolution without reading file content — rules out deferring containment to daemon dispatch or stuffing content into `context.seed`.
- Containment uses strict `realpathSync` on the registered project root and on `resolve(cwd, seedPath)`, then the same `inside()` semantics as intent `resolveSeed` — rules out lexical-only checks, a second containment policy, or symlink/plain outside-root escapes (`../` traversal included).
- `realpathSync` or other canonicalization failures on the seed path surface as `pipeline: cannot resolve seed path: …` — rules out silent fallback to lexical containment.
- After containment passes, admission probes read access without loading content; unreadable paths reject with the same `pipeline: cannot resolve seed path: …` family — rules out dropping today's unreadable rejection when `readFileSync` is removed.
- `--seed` admits `context.seedPath` only (operator-relative CLI argument verbatim); `--seed-text` admits `context.seed` only — rules out dual-populating both fields for one launch.
- Admission refuses absolute path, missing path, directory, outside-root resolved path, symlink escape, and unreadable path before daemon connect — rules out durable pipeline rows for unresolvable seeds.
- `pipeline_start` RPC carries the updated context shape only; no daemon admission re-validation — rules out duplicating path checks in the daemon handler.
- Admission-only slice: merged work persists `seedPath` on `--seed`, but intent-stage dispatch still reads `context.seed` until sibling `pipeline-intent-stage-seed-path-identity` lands — rules out treating merged admission as shippable E2E file-seed behavior.

## Task checklist

- Extend `resolvePipelineSeed` in `v2/src/commands/pipeline.ts` to accept the registered project root, apply intent-style `realpathSync` + `inside()` containment, probe read access without `readFileSync`, and return the operator-relative path.
- Build `PipelineContext` in `runPipelineStartCommand` with `seedPath` or `seed` exclusively per launch mode.
- Rework happy-path and rejection fixtures so seeds resolve under the registered `<project>` root (use `cwd` inside `fx.repoRoot` or paths relative to it); current tests use `cwd` in a temp dir outside `fx.repoRoot` and will fail new containment without fixture rework.
- Replace `reads --seed from a relative file path` with `pipeline_start` context-shape assertions; add outside-root, symlink-escape, and guard-inversion coverage in `v2/src/commands/pipeline.test.ts`.
- Document `--seed` pre-admission containment and unreadable probe in `v2/docs/write-behavior.md`; record corrected admission shape in `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `pipeline.test.ts` — replace `reads --seed from a relative file path` with assertions that `pipeline_start` context sets `seedPath` to the operator-relative CLI argument, `context.seed` is absent, and the fixture seed resolves inside the registered project root; fails pre-fix; `Mutation checkpoint:` stuffing file text into `context.seed` turns the test RED.
- [ ] `pipeline.test.ts` — `prints admitted pipeline ID on valid start` stays green (`--seed-text` admits inline `context.seed` with no `seedPath`); `Mutation checkpoint:` setting `seedPath` on the text branch turns the test RED.
- [ ] `pipeline.test.ts` — `rejects --seed %p before daemon connect` and `rejects unreadable --seed file before daemon connect` stay green.
- [ ] `pipeline.test.ts` — resolved path outside the registered project root (`../` traversal) and symlink escape outside `projects.<projectKey>.root` each exit non-zero with a named stderr error and no daemon contact; fails pre-fix; `Mutation checkpoint:` inverting the project-root containment guard in `resolvePipelineSeed` turns both cases RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — `jarvis pipeline start --seed` pre-admission failures include containment under the registered `<project>` root after symlink resolution (outside-root and symlink escape), unreadable-path probe without inlining content, and `realpathSync` resolution failures; admitted `--seed` context carries `seedPath` only.
- `v2/docs/v1-behaviors.md` — record that `pipeline start --seed` admits `seedPath` without inlining file content into `seed`.
