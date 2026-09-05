# Re-key shared/prompts/review-implement-contract-preservation.test.ts

## Problem

Row `shr-ricp-contract-markers` pins implement review role contracts to hand-maintained marker substring lists and a one-way `.not.toContain` absence check on critic bodies (`vacuous-pass-risk: yes`).

## Decision ledger

- Merge-base diff contract phrases are read from a shared committed marker set or registry metadata, not duplicated `MERGE_BASE_DIFF_MARKERS` literals only in the test; rules out marker lists that drift from the prompt corpus.
- Critic absence of adversary identify checklist markers pairs `.not.toContain` with a presence check on the adversary role body using the same marker set; rules out one-way absence that passes when critic body is empty or markers are vacuously absent.
- Marker lookups route through shared loud-failure locators when slicing rendered bodies; rules out silent pass when a required marker cannot be located.

## Task checklist

- [ ] Re-key audit row `shr-ricp-contract-markers` per the decision ledger.
- [ ] Pair critic absence assertions with adversary presence assertions for `ADVERSARY_IDENTIFY_LIST_MARKERS`.

## Acceptance criteria

- [ ] `shared/prompts/review-implement-contract-preservation.test.ts` test `implement review role contract substrings preserved` derives merge-base and role contract markers from a shared source-of-truth constant and pairs critic `.not.toContain` checks with adversary presence checks; it fails against the pre-fix one-way absence pins (`vacuous-pass-risk: yes` on audit row `shr-ricp-contract-markers`) and passes after re-key.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:shared` passes.
- [ ] `bun run test:integration:shared` passes.

## Documentation updates

None — locator contract is pinned by tests and adopted by later surface intents.
