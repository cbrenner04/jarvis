---
name: pipeline-context-seed-path-field
---

# Pipeline admission context distinguishes seed path from inline seed text

## Problem

`PipelineContext.seed` holds a single string. `pipeline start --seed <path>` inlines file
contents there, so the daemon cannot tell a path-supplied seed from `--seed-text` and cannot
persist the path for landing consumption.

## Decisions

- Add optional project-relative `seedPath` to `PipelineContext` — rules out overloading `seed` to mean path or inline with runtime guessing.
- `seed` carries `--seed-text` inline prose only; omit it when `seedPath` is set — rules out duplicating file content in persisted context.
- Pre-migration rows with only `seed` load unchanged — rules out rewriting existing pipeline context snapshots.

## Acceptance criteria

- [ ] `state-store.test.ts` — admitted `PipelineContext` with `seedPath` and without `seed` round-trips through `createPipeline` / store reload; omitting `seedPath` on the type makes the test fail.
- [ ] `state-store.test.ts` — legacy context JSON with only `seed` still loads — rules out breaking in-flight or historical pipeline rows.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — `PipelineContext` documents `seedPath` vs inline `seed`.

## Prerequisites

