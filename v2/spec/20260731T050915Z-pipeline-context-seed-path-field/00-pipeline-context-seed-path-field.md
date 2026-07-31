# Pipeline context seed path field

## Problem

`PipelineContext.seed` is a single required string. Path-supplied and inline seeds cannot be distinguished after persistence, and landing cannot recover the admitted path.

## Prerequisites

Sibling intents `pipeline-start-seed-path-admission` and `pipeline-intent-stage-seed-path-identity` depend on this spec landing first; admission routing (`--seed` / `--seed-text`) and stage consumption ship in those intents, not here.

## Decisions

- Add optional `seedPath?: string`; make inline `seed?: string` optional — rules out a required `seed` field or one overloaded field for path vs inline.
- `createPipeline` / `loadPipeline` persist and reload `context` JSON opaquely; no migrate-on-read from legacy `seed`-only rows — rules out rewriting in-flight or historical snapshots.
- Stage resolution is unchanged until `pipeline-intent-stage-seed-path-identity` lands — rules out stage consumers reading `seedPath` in this PR.
- Admission mutual exclusivity (`seedPath` xor `seed` on new admissions) is documented on `PipelineContext` and enforced by admission callers (`pipeline-start-seed-path-admission`), not validated in the store on this slice — rules out store-side rejection of dual-populated JSON here.
- Store-side rejection of dual-populated `seedPath`+`seed` remains unscheduled; mutual exclusivity is enforced at admission, not validated in the store on this slice.

## Task checklist

- Extend `PipelineContext` in `state-store.ts` with optional `seedPath`; make `seed` optional.
- Extend `PipelineContext` JSDoc: optional fields, mutual exclusivity for new admissions, store does not require either seed field.
- Fix `PipelineContext` fixtures and compile sites across v2 affected by optional `seed` (e.g. `SAMPLE_PIPELINE_CONTEXT`, daemon pipeline tests, `baseContext` helpers).
- Add `state-store.test.ts` coverage for `seedPath` round-trip and legacy `seed`-only reload.
- Update `v2/docs/state-store.md` for the expanded context shape, persistence boundary, and admission mutual exclusivity.

## Acceptance criteria

- [ ] Typed `PipelineContext` admission with `seedPath` and without `seed` fails `bun run typecheck` pre-fix (required `seed`, missing `seedPath` on the type); `state-store.test.ts` round-trip through `createPipeline` / store reload passes after the type change; `Mutation checkpoint:` omitting `seedPath` from the admitted snapshot makes the test fail.
- [ ] `state-store.test.ts` — legacy context JSON with only `seed` still loads unchanged; `Mutation checkpoint:` asserting `seedPath` is present on reload makes the test fail.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — `PipelineContext` documents optional `seedPath` and optional inline `seed`; store does not require either on admission; path strings are admission-supplied and relative-base resolution is not store responsibility (see admission sibling); dual-populated or legacy ambiguous rows load as stored with no migrate-on-read; store validation deferred; admission mutual exclusivity for new admissions.
- Optionally `v2/docs/v1-behaviors.md` — additive context-field bullet lists optional `seedPath` for catalog accuracy (docs-only; not operator-behavior change).
