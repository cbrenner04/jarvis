# Re-key write.test.ts spec-guidance pin

## Problem

Row `ex-wr-spec-guidance-prose` in `v2/docs/structural-invariant-test-audit.md` pins plan draft spec-guidance isolation to a hand-maintained substring checklist on `extractSpecGuidance(capturedPrompt)`, so committed spec-guidance edits that preserve operator/agent boundaries red-gate when phrasing shifts.

## Decision ledger

- Spec-guidance isolation compares extracted prompt guidance against `readSpecGuidance()` (plus committed operator-only markers the test already owns), not an ad-hoc substring inventory; rules out brittle phrase lists that duplicate the committed guidance corpus.
- Step-rule leakage checks remain explicit absence assertions for known forbidden tokens (for example `STEP_COMPLETION_SENTINEL`, `jarvis1` paths); rules out folding leakage detection into unrelated guidance phrase pins.

## Task checklist

- [ ] Re-key audit row `ex-wr-spec-guidance-prose` per the decision ledger.
- [ ] Replace hand-maintained guidance substring pins with comparison to `readSpecGuidance()` output and retained forbidden-token absence checks.

## Acceptance criteria

- [ ] `v2/src/execution/write.test.ts` test `plan preset draft step isolates bundled human-only marker guidance` compares extracted guidance to `readSpecGuidance()` rather than a hand-maintained substring checklist; it fails against the pre-fix phrase inventory and passes after re-key.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

None — patterns land in `v2/docs/test-writing.md` via a later intent.
