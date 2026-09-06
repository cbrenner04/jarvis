# Re-key shared/prompts/review-prompt-divergence.test.ts

## Problem

Row `shr-rpd-patch-implement-divergence` pins patch versus implement review divergence to per-role substring presence/absence checks that can pass vacuously when a registry body is empty (`vacuous-pass-risk: yes`).

## Decision ledger

- Patch/implement divergence asserts property differences on non-empty registry bodies loaded by role id, not substring pins alone; rules out `.toContain` / `.not.toContain` checks that pass when both bodies are empty.
- Unified-diff wording checks use a shared committed marker set for implement merge-base prose and patch summary-only prose; rules out duplicated substring literals per test case.
- When a required marker cannot be located in a non-empty body, lookup fails loudly through shared locators; rules out silent absence that reads as divergence.

## Task checklist

- [ ] Re-key audit row `shr-rpd-patch-implement-divergence` in case `patch vs implement review prompt registry-body divergence > * branch-diff prose diverges`.
- [ ] Guard divergence assertions against empty registry bodies before substring checks.

## Acceptance criteria

- [x] `shared/prompts/review-prompt-divergence.test.ts` branch-diff divergence cases assert on non-empty patch and implement registry bodies using shared marker constants and fail when either body is empty; they fail against the pre-fix vacuous substring pins (`vacuous-pass-risk: yes` on audit row `shr-rpd-patch-implement-divergence`) and pass after re-key.
- [x] `bun run typecheck` passes.
- [x] `bun run test:shared` passes.
- [x] `bun run test:integration:shared` passes.

## Documentation updates

None — locator contract is pinned by tests and adopted by later surface intents.
