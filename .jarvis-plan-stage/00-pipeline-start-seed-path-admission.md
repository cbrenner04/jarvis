# Pipeline start seed path admission

## Problem

`pipeline start --seed <path>` reads the file at admission and stores its contents in
`PipelineContext.seed`, so downstream intent resolution cannot use the path branch of
`resolveIntentSeed`.

## Decisions

- `resolvePipelineSeed` validates relative path, existence, is-file, and containment under `projects.<projectKey>.root` (registered root for the `<project>` argument, not invocation `cwd` or a cwd-matched project) after symlink resolution without reading file content — rules out deferring containment to daemon dispatch or stuffing content into `context.seed`.
- Containment compares `realpathSync` of the registered project root and of `resolve(cwd, seedPath)` — rules out lexical-only checks that accept in-root symlink escapes.
- `--seed` admits `context.seedPath` only (operator-relative CLI argument verbatim); `--seed-text` admits `context.seed` only — rules out dual-populating both fields for one launch.
- Admission refuses absolute path, missing path, directory, symlink escape, and unreadable path before daemon connect — rules out durable pipeline rows for unresolvable seeds.
- `pipeline_start` RPC carries the updated context shape only; no daemon admission re-validation — rules out duplicating path checks in the daemon handler.
- Reuse implement-style resolved-root containment semantics where practical — rules out a second containment policy for the same registered-root contract.

## Task checklist

- Extend `resolvePipelineSeed` in `v2/src/commands/pipeline.ts` to accept the registered project root, perform resolved-root containment, and return the operator-relative path without `readFileSync`.
- Build `PipelineContext` in `runPipelineStartCommand` with `seedPath` or `seed` exclusively per launch mode.
- Replace `reads --seed from a relative file path` and add rejection, `pipeline_start` shape, and guard-inversion coverage in `v2/src/commands/pipeline.test.ts`.
- Document `--seed` pre-admission containment in `v2/docs/write-behavior.md`; record corrected admission shape in `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `pipeline.test.ts` — `--seed` on a relative file admits `context.seedPath` matching the operator path and omits inlined file content from `context.seed`; fails pre-fix; `Mutation checkpoint:` stuffing file text into `context.seed` turns the test RED.
- [ ] `pipeline.test.ts` — `--seed-text` still admits inline `context.seed` with no `seedPath`; fails pre-fix if path admission shape leaks into the text branch; `Mutation checkpoint:` setting `seedPath` on the text branch turns the test RED.
- [ ] `pipeline.test.ts` — absolute path, missing file, directory, symlink escape outside `projects.<projectKey>.root`, and unreadable file each exit non-zero with a named stderr error and no daemon contact; fails pre-fix if any case reaches `pipeline_start`; `Mutation checkpoint:` inverting the project-root containment guard in `resolvePipelineSeed` turns the symlink-escape case RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — `jarvis pipeline start --seed` pre-admission failures include containment under the registered `<project>` root after symlink resolution; admitted `--seed` context carries `seedPath` only.
- `v2/docs/v1-behaviors.md` — record that `pipeline start --seed` admits `seedPath` without inlining file content into `seed`.
