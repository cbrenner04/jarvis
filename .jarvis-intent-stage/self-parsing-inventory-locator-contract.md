---
name: self-parsing-inventory-locator-contract
---

# Shared locator binds a module's own inventory declaration, not the first regex match

## Problem

Self-parsing structural tests regex their own source for an inventory constant. A same-shaped fixture later in the file can become the first match after lint autofix prefixes the real constant with `_`. Existing `shared/structural-test-locator.ts` guards only absent and empty subjects, so a wrong but well-formed fixture inventory passes silently.

## Behavior

- A shared helper resolves the inventory array body for a named constant in a module source string by proving the match is the module inventory declaration the caller named, not an incidental fixture of the same shape.
- The helper tolerates an optional leading `_` on the constant spelling (lint-unused rename) without requiring unprefixed-only patterns.
- When resolution would return a declaration other than the one the caller pointed at (including a fixture), it throws a named `StructuralTestLocatorError` (or dedicated kind) instead of returning the fixture contents.
- Parse-only inventory constants carry an explicit marker comment naming the self-parsing contract so lint autofix does not silently change what the locator must match.

## Decisions

- Contract lives in `shared/structural-test-locator.ts` with co-located regressions; rules out ad hoc regex in each `*-anchors` inventory test.
- Fixture placement for locator unit tests uses a separate synthetic source string or a form the binding rules exclude; rules out indistinguishable fixture and inventory in the same binding test.
- Rules out disabling Biome unused rename on parse-only constants; the locator and marker carry the contract instead.

## Prerequisites

## Acceptance criteria

- [ ] A regression in `shared/structural-test-locator.test.ts` proves the helper returns the module inventory when the same source also contains a same-shaped fixture declaration later; it fails against a first-match-wins regex (reachable on main via `workflow-runner-resume-inventory.test.ts` `parseResumePathInventoryAnchors` matching the fixture at line 529 when the real declaration is prefixed `_`).
- [ ] A regression proves the helper resolves the real inventory with and without the `_` prefix; it fails against a pattern that requires the unprefixed spelling only.
- [ ] A regression proves the helper throws a named locator error when pointed at a declaration name but resolution would bind a different same-shaped declaration; it fails against absent/empty-only guards that accept a well-formed fixture inventory.
- [ ] `bun run typecheck`, `bun run test:shared`, and `bun run test:integration:shared` pass.

## Documentation updates

- None — operator and author contract lands in the docs intent after behavior is observable in code and tests.
