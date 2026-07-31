---
name: pipeline-context-seed-path-field
---

# Pipeline admission context distinguishes seed path from inline seed text

## Problem

`PipelineContext.seed` holds a single string. `pipeline start --seed <path>` inlines file
contents there, so the daemon cannot tell a path-supplied seed from `--seed-text` and cannot
persist the path for landing consumption.

## Decisions

- Add optional project-relative `seedPath?: string`; make inline `seed?: string` optional too — rules out a required `seed` field that forces inlining or sentinel values.
- Runtime invariant: at most one of `seedPath` or `seed` is set on new admissions; `--seed` sets `seedPath` only, `--seed-text` sets `seed` only — rules out dual-populated context or overloading one field to mean path or inline.
- Pre-migration rows with only `seed` load unchanged — rules out rewriting existing pipeline context snapshots.

## Acceptance criteria

- [ ] `state-store.test.ts` — admitted `PipelineContext` with `seedPath` and without `seed` round-trips through `createPipeline` / store reload; omitting `seedPath` on the type makes the test fail.
- [ ] `state-store.test.ts` — legacy context JSON with only `seed` still loads — rules out breaking in-flight or historical pipeline rows.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — `PipelineContext` documents optional `seedPath` and optional inline `seed`, plus admission mutual exclusivity.

## Prerequisites
