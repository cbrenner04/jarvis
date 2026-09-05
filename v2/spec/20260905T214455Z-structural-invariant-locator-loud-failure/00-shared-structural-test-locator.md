# Shared structural-test locator module and regression tests

## Problem

Structural-invariant tests slice production or fixture source by marker, symbol, or discovered file. Local helpers that return `""`, `[]`, or `undefined` on a failed lookup let downstream assertions pass vacuously when the subject moves or disappears.

## Decision ledger

- Locator contract lives in `shared/structural-test-locator.ts` and is consumed by shared and later surface structural tests; rules out duplicating loud-failure slicing per test file.
- Failed lookup throws `StructuralTestLocatorError` with `kind` and `searchKey`; rules out returning empty values and letting callers assert against emptiness.
- Three surviving locator shapes from the audit problem statement — `marker-slice`, `symbol-slice`, `discovered-file` — cover every vacuous-pass-risk anchor mechanism that slices source (`section()`-style symbol bounds, marker captures, discovered production paths); rules out one umbrella helper or a single happy-path regression.
- `marker-slice` extracts bounded text between start/end markers or a regex capture group; rules out silent `""` when either bound is absent.
- `symbol-slice` extracts text from a declaration anchor through an end anchor across one or more candidate source texts; rules out silent `""` when the start anchor is absent in every candidate.
- `discovered-file` resolves a relative production path from a discovered file set and reads it; rules out silent skip when the path is missing from discovery or on disk.
- Co-located `shared/structural-test-locator.test.ts` holds one miss/present regression per shape; rules out relying on downstream re-key tests to prove loud failure.

## Task checklist

- [ ] Add `shared/structural-test-locator.ts` exporting `StructuralTestLocatorError`, `locateMarkerSlice`, `locateSymbolSlice`, and `locateDiscoveredFile`.
- [ ] Add `shared/structural-test-locator.test.ts` with one regression per locator shape that fails when the subject is absent and passes when present; each regression must fail against a pre-fix helper that returns `""` on miss.

## Acceptance criteria

- [ ] `shared/structural-test-locator.ts` exports locators that throw `StructuralTestLocatorError` with `kind` and `searchKey` on failed lookup rather than returning empty values; reachable on main via `daemon-workflow-start.test.ts` local `section()` returning `owner.slice(from, toIndex === -1 ? undefined : toIndex)` when `end` is absent and via `module-boundary-surfaces.test.ts` `sectionBulletLines` returning `[]` when a heading is absent.
- [ ] `shared/structural-test-locator.test.ts` test `marker-slice fails loudly when bounds are absent` fails against a locator that returns `""` on miss and passes after loud-failure routing.
- [ ] `shared/structural-test-locator.test.ts` test `symbol-slice fails loudly when the start anchor is absent` fails against a locator that returns `""` on miss and passes after loud-failure routing.
- [ ] `shared/structural-test-locator.test.ts` test `discovered-file fails loudly when the path is missing` fails against a locator that returns `""` on miss and passes after loud-failure routing.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:shared` passes.
- [ ] `bun run test:integration:shared` passes.

## Documentation updates

None — locator contract is pinned by tests and adopted by later surface intents.
