# Parse-only inventory array binding in shared structural-test locator

Self-parsing structural tests regex their own source for an inventory constant. A same-shaped fixture later in the file can become the first match after lint autofix prefixes the real constant with `_`. `shared/structural-test-locator.ts` today throws only when the subject is absent or empty, so a wrong but well-formed fixture inventory passes silently.

## Decision ledger

- Parse-only inventory binding lives in `shared/structural-test-locator.ts` with co-located regressions; rules out ad hoc first-match regex in each `*-anchors` or inventory self-parse test.
- Resolution returns the array literal body for the caller-named `const` (optional leading `_` on the spelling) only when that declaration carries the exported parse-only inventory marker comment; rules out matching a later same-shaped `const … = [` block that lacks the marker or a different identifier.
- Wrong binding (named constant missing, marker absent on the named declaration, or a same-shaped non-marker declaration would win under first-match) throws `StructuralTestLocatorError` with kind `inventory-binding`; rules out a separate error class or returning fixture contents.
- Locator unit tests place fixtures in synthetic source strings shaped so binding rules exclude them from the module inventory under test, or assert throw on deliberate mis-binding; rules out an indistinguishable fixture and inventory pair in one binding-success test.
- Rules out disabling Biome unused rename on parse-only constants; the marker comment and locator carry the contract instead.

## Task checklist

- Extend `StructuralTestLocatorKind` with `inventory-binding` and export a parse-only inventory marker comment literal from `shared/structural-test-locator.ts`.
- Add a shared helper that resolves the inventory array body from a module source string plus constant name, enforcing marker presence on the bound declaration and optional `_` prefix tolerance on the constant spelling.
- Add regressions in `shared/structural-test-locator.test.ts` covering fixture-after-real binding, marker requirement, `_` prefix tolerance, and wrong-binding throw; keep local silent first-match helpers in the test file only for contrast with pre-fix behavior.

## Acceptance criteria

- [x] `shared/structural-test-locator.test.ts` adds a regression that returns the marked caller-named inventory array body when the source has a `_`-prefixed marked module `const` and a later unprefixed same-named same-shaped fixture; a local unprefixed-spelling-only regex contrast in that test binds the fixture body (reachable on main when lint prefixes the module inventory while an unprefixed same-named fixture remains, as in `v2/src/execution/workflow-runner-resume-inventory.test.ts` inventory self-parse with unprefixed-only binding); the shared helper binds by constant name and parse-only marker, not by the contrast regex.
- [x] `shared/structural-test-locator.ts` exports the parse-only inventory marker comment literal and inventory resolution requires that marker on the bound declaration; `shared/structural-test-locator.test.ts` fails when the marker is absent on the named inventory `const`.
- [x] `shared/structural-test-locator.test.ts` adds a regression that resolves the real inventory with and without a leading `_` on the constant name; it fails against a pattern that requires the unprefixed spelling only.
- [x] `shared/structural-test-locator.test.ts` adds a regression that throws `StructuralTestLocatorError` with kind `inventory-binding` when pointed at a constant name but resolution would bind a different same-shaped declaration; it fails against absent/empty-only guards that accept a well-formed fixture inventory.
- [x] `bun run typecheck` passes.
- [x] `bun run test:shared` passes.
- [x] `bun run test:integration:shared` passes.

## Documentation updates

None — operator and author contract lands in a follow-up docs intent after behavior is observable in code and tests.
