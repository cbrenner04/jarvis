# Pipeline context seed path field

## Problem

`PipelineContext.seed` is a single required string. Path-supplied and inline seeds cannot be distinguished after persistence, and landing cannot recover the admitted path.

## Decisions

- Add optional project-relative `seedPath?: string`; make inline `seed?: string` optional — rules out a required `seed` field or one overloaded field for path vs inline.
- `createPipeline` / `loadPipeline` persist and reload `context` JSON opaquely; no migrate-on-read from legacy `seed`-only rows — rules out rewriting in-flight or historical snapshots.
- Admission mutual exclusivity (`seedPath` xor `seed` on new admissions) is documented on `PipelineContext` and enforced by admission callers, not validated in the store on this slice — rules out store-side rejection of dual-populated JSON here.
- Deferred to first consumer: store-side rejection of dual-populated `seedPath`+`seed` context — pin when a caller needs durable rows validated at persistence admission.

## Task checklist

- Extend `PipelineContext` in `state-store.ts` with optional `seedPath`; make `seed` optional.
- Add `state-store.test.ts` coverage for `seedPath` round-trip and legacy `seed`-only reload.
- Update `v2/docs/state-store.md` for the expanded context shape and admission mutual exclusivity.

## Acceptance criteria

- [ ] `state-store.test.ts` — admitted `PipelineContext` with `seedPath` and without `seed` round-trips through `createPipeline` / store reload; omitting `seedPath` from the admitted snapshot (comment checkpoint on the pinning test) makes the test fail.
- [ ] `state-store.test.ts` — legacy context JSON with only `seed` still loads unchanged; asserting `seedPath` is present on reload (comment checkpoint on the pinning test) makes the test fail.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — `PipelineContext` documents optional `seedPath` and optional inline `seed`, plus admission mutual exclusivity.
