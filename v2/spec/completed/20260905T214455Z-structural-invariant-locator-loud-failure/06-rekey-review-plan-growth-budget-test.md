# Re-key shared/prompts/review-plan-growth-budget.test.ts

## Problem

Rows `shr-rpgb-body-baselines` and `shr-rpgb-role-placeholders` anchor plan review growth and placeholder invariants to hand-maintained baseline maps and frontmatter string literals instead of registry artifact metadata.

## Decision ledger

- Body-length ceilings derive from committed baseline exports co-located with the test compared against `registry.getById(id).body.length`, not duplicated numeric literals inside a private map only; rules out a second baseline table that drifts from the exported constants.
- Placeholder expectations derive from each artifact's committed frontmatter via a shared reader that throws on missing fields, not a hand-maintained role-to-string map; rules out literal placeholder strings duplicated only in the test.
- Frontmatter field extraction routes through shared loud-failure marker slicing; rules out silent empty reads when frontmatter delimiters move.

## Task checklist

- [ ] Re-key audit rows `shr-rpgb-body-baselines` and `shr-rpgb-role-placeholders` per the decision ledger.
- [ ] Replace local frontmatter parsing with shared loud-failure locators.

## Acceptance criteria

- [x] `shared/prompts/review-plan-growth-budget.test.ts` test `plan review role body growth stays within budget` compares registry body lengths against exported baseline constants without a duplicated private baseline map; it fails against the pre-fix `PLAN_REVIEW_ROLE_BASELINES` object literal and passes after re-key.
- [x] `shared/prompts/review-plan-growth-budget.test.ts` test `plan review role placeholders unchanged` reads placeholders from each artifact's committed frontmatter via a loud-failure helper rather than a hand-maintained expected map; it fails against the pre-fix `PLAN_REVIEW_ROLE_PLACEHOLDERS` literal map and passes after re-key.
- [x] `bun run typecheck` passes.
- [x] `bun run test:shared` passes.
- [x] `bun run test:integration:shared` passes.

## Documentation updates

None — locator contract is pinned by tests and adopted by later surface intents.
