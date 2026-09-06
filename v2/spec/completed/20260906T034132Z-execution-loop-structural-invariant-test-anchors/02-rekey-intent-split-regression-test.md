# Re-key intent-split-regression.test.ts

## Problem

Rows `ex-isr-fixture-seeds` and `ex-isr-primary-surfaces` in `v2/docs/structural-invariant-test-audit.md` pin intent-split regression oracles to module-scope fixture reads and hand-maintained `PRIMARY_SURFACES` / `EXECUTION_LOOP_SURFACE` lists, so new module-boundary surfaces or renamed fixture paths pass vacuously or red-gate unrelated split work.

## Decision ledger

- Seed fixture bytes load through committed fixture path constants beside `fixtures/intent-split-*` with loud-failure reads, not import-time `readFileSync` compared to stale module bindings; rules out module-scope seed content captured before fixture edits.
- Expected primary implementation surfaces for multi-surface seeds derive from `MODULE_BOUNDARY_SURFACES` / surface-classification helpers on the staged intent bodies, not a hand list of repo paths; rules out `PRIMARY_SURFACES` literals beside the production split oracle.
- Staging oracles keep behavioral assertions on emitted ready-intent filenames and surface pins; rules out replacing oracles with filename equality against a static manifest.

## Task checklist

- [x] Re-key audit rows `ex-isr-fixture-seeds` and `ex-isr-primary-surfaces` per the decision ledger.
- [x] Replace module-scope seed content mirrors with fixture-path registry loads via loud-failure locators.
- [x] Derive expected surfaces from shared module-boundary classification instead of `PRIMARY_SURFACES` / `EXECUTION_LOOP_SURFACE` literals.

## Acceptance criteria

- [x] `v2/src/execution/intent-split-regression.test.ts` seed inputs load from committed fixture path constants with loud-failure routing rather than import-time `readFileSync` mirrors; it fails against the pre-fix module-scope seed bindings and passes after re-key.
- [x] `intent-split-regression.test.ts` test `multi-surface seed fans out by surface through the production split write` derives expected primary surfaces from module-boundary classification, not `PRIMARY_SURFACES` literals; it fails against the pre-fix hand-maintained path list and passes after re-key.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

None — patterns land in `v2/docs/test-writing.md` via a later intent.
