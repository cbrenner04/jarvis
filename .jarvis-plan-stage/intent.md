---
name: pipeline-start-seed-path-admission
---

# Pipeline start admits file seeds by path without inlining content

## Problem

`pipeline start --seed <path>` reads the file at admission and stores its contents in
`PipelineContext.seed`, so downstream intent resolution cannot use the path branch of
`resolveIntentSeed`.

## Decisions

- `resolvePipelineSeed` validates relative path, existence, is-file, and containment under `projects.<projectKey>.root` (the registered root for the `<project>` argument, not invocation `cwd` or a cwd-matched project) after symlink resolution without reading file content into context — rules out deferring containment to daemon dispatch or stuffing content into `context.seed`.
- `--seed` admits `context.seedPath` only; `--seed-text` admits `context.seed` only — rules out dual-populating both fields for one launch.
- Admission refuses absolute path, missing path, directory, symlink escape, and unreadable path before daemon connect — rules out durable pipeline rows for unresolvable seeds.
- `pipeline_start` RPC carries the updated context shape only; no daemon admission re-validation — rules out duplicating path checks in the daemon handler.

## Acceptance criteria

- [ ] `pipeline.test.ts` — `--seed` on a relative file admits `context.seedPath` matching the operator path and omits inlined file content from `context.seed`; stuffing file text into `context.seed` makes the test fail.
- [ ] `pipeline.test.ts` — `--seed-text` still admits inline `context.seed` with no `seedPath`; a regression guard fails if path admission shape leaks into the text branch.
- [ ] `pipeline.test.ts` — absolute path, missing file, directory, symlink escape outside `projects.<projectKey>.root`, and unreadable file each exit non-zero with a named stderr error and no daemon contact; reaching `pipeline_start` makes the test fail.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — `jarvis pipeline start --seed` pre-admission failures include containment under the registered `<project>` root after symlink resolution.

## Prerequisites

- `PipelineContext` accepts optional project-relative `seedPath` distinct from inline `seed`.
