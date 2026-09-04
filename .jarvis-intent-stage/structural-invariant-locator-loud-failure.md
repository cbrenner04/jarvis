---
name: structural-invariant-locator-loud-failure
---

# Structural-invariant locators fail loudly and shared tests re-key

## Problem

Structural tests that slice source by marker, symbol, or discovered file can return an empty string when extraction moves the subject, making assertions vacuous instead of red. Shared structural-invariant tests under `shared/**` share the same incidental-anchor class as surface tests.

## Behavior

- Shared locator helpers used by structural-invariant tests throw a named error when the subject cannot be located; they never return an empty string for a failed lookup.
- Each surviving locator shape named in the audit gets a regression test that fails when the subject is absent and passes when present.
- Re-key every `shared/**` structural-invariant test the audit tagged `re-key` to source-of-truth anchors and adopt the shared locators.

## Decision ledger

- Locator contract lives in `shared/` and is consumed by surface tests; rules out duplicating loud-failure logic per daemon or execution-loop file.
- Failed lookup throws a named error including the locator kind and search key; rules out returning `""` or `undefined` and letting callers assert against emptiness.
- Regression coverage is per locator shape from the audit, not one umbrella test; rules out a single happy-path test that misses vacuous-failure shapes.

## Prerequisites

- `v2/docs/structural-invariant-test-audit.md` catalogs structural-invariant tests and classifies each anchor.

## Primary implementation surface

- `shared/`

## Acceptance criteria

- [ ] A regression test per surviving locator shape named in `v2/docs/structural-invariant-test-audit.md` fails when the subject is absent and passes when present; each fails against a locator that returns an empty string on miss.
- [ ] `shared/structural-test-locator.ts` exports locators that throw named errors on failed lookup rather than returning empty values.
- [ ] Every `shared/**` structural-invariant test tagged `re-key` in `v2/docs/structural-invariant-test-audit.md` anchors on its source of truth or documents `stay-incidental` unchanged.
- [ ] `bun run typecheck`, `bun run test:shared`, and `bun run test:integration:shared` pass.

## Documentation updates

- None — locator contract is pinned by tests and adopted by later surface intents.
