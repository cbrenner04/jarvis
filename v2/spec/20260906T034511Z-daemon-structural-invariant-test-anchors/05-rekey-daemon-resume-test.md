# Re-key daemon-resume.test.ts

## Problem

Row `dm-resume-intent-lint-fixture` in `v2/docs/structural-invariant-test-audit.md` pins populated-stage intent finalization seeds to module-level `readFileSync` byte equality with `intent-md038-clean.md`, so intentional golden refresh that preserves lint-clean semantics red-gates resume admission and republication cases.

## Decision ledger

- Populated-stage intent seeds assert MD038-clean staged-markdown property (or route through the shared staged-markdown fixture registry), not module-level golden byte equality; rules out red-gates on fixture refresh that preserve lint semantics.
- Deferred to first consumer: whether intent-stage seeding shares one helper with execution-loop staged-markdown tests — pin when a caller needs it.

## Task checklist

- [ ] Re-key audit row `dm-resume-intent-lint-fixture` per the decision ledger.
- [ ] Replace module-level `LINT_CLEAN_INTENT_STAGE_MD` golden bytes with lint-contract or registry-backed seed content.

## Acceptance criteria

- [ ] `daemon-resume.test.ts` test `admits a populated-stage intent finalization landing_failed row instead of unsupported_resume_context` seeds intent stage markdown via lint-contract assertion rather than module-level `readFileSync` golden bytes; it fails against the pre-fix `LINT_CLEAN_INTENT_STAGE_MD` `readFileSync` pin on audit row `dm-resume-intent-lint-fixture` and passes after re-key.
- [ ] `daemon-resume.test.ts` test `resumes a populated-stage intent finalization end to end: landing_failed projects resumable, completed after republication` stays green.
- [ ] `bun run typecheck` passes.

## Documentation updates

None — patterns land in `v2/docs/test-writing.md` via a later intent.
