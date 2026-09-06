# Re-key plan-workflow-steps.test.ts spec-guidance pin

## Problem

Row `ex-pws-spec-guidance-prose` in `v2/docs/structural-invariant-test-audit.md` pins plan draft prompts to an arbitrary 80-character prefix of `readSpecGuidance()` output, so spec-guidance edits that preserve the contract but move opening prose red-gate the step-builder tests.

## Decision ledger

- Plan draft prompt embedding asserts the captured prompt contains the full `readSpecGuidance()` body (or a shared normalization thereof), not `specGuidance.slice(0, 80)`; rules out prefix pins that break on benign reordering above the fold.
- Spec-guidance sourcing stays on `readSpecGuidance()` from `shared/spec-guidance-path.ts`; rules out duplicating guidance fragments as expected literals in the test.

## Task checklist

- [ ] Re-key audit row `ex-pws-spec-guidance-prose` per the decision ledger.
- [ ] Replace the 80-character prefix assertion with a whole-body or shared-helper containment check against `readSpecGuidance()`.

## Acceptance criteria

- [ ] `v2/src/execution/plan-workflow-steps.test.ts` plan preset draft write step cases assert the captured prompt embeds committed spec guidance via `readSpecGuidance()` without a fixed prefix slice; it fails against the pre-fix `specGuidance.slice(0, 80)` pin and passes after re-key.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

None — patterns land in `v2/docs/test-writing.md` via a later intent.
