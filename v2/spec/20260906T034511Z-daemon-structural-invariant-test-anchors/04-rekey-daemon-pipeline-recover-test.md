# Re-key daemon-pipeline-recover.test.ts

## Problem

Row `dm-pipeline-recover-plan-fixture` in `v2/docs/structural-invariant-test-audit.md` pins recovery landing to `readFileSync` byte equality with a committed golden fixture path, so intentional golden refresh that preserves lint-clean semantics red-gates the suite.

## Decision ledger

- Corrected plan subspec landing asserts staged-markdown lint-clean property (or routes through the shared staged-markdown fixture registry), not byte equality with `plan-md012-clean-subspec.md`; rules out red-gates on golden bytes that still satisfy MD012-clean semantics.
- Deferred to first consumer: whether recovery cases share one helper with `pipeline-stage-recovery.test.ts` — pin when a caller needs it.

## Task checklist

- [ ] Re-key audit row `dm-pipeline-recover-plan-fixture` per the decision ledger.
- [ ] Replace golden `readFileSync` byte oracle with lint-contract or registry-backed assertion for the landed subspec body.

## Acceptance criteria

- [ ] `daemon-pipeline-recover.test.ts` test `pipeline_recover admits and lands a corrected non-first fan-out branch without redrafting` asserts the landed plan subspec satisfies the staged-markdown lint contract, not byte equality with `execution/fixtures/write-loop-staged-markdown-lint/plan-md012-clean-subspec.md`; it fails against the pre-fix `readFileSync` golden bytes on audit row `dm-pipeline-recover-plan-fixture` and passes after re-key.
- [ ] `bun run typecheck` passes.

## Documentation updates

None — patterns land in `v2/docs/test-writing.md` via a later intent.
