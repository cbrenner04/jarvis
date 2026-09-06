# Re-key pipeline-stage-recovery.test.ts

## Problem

Row `dm-pipe-recovery-plan-fixture` in `v2/docs/structural-invariant-test-audit.md` pins branch recovery landing to `readFileSync` byte equality with `plan-md012-clean-subspec.md`, so intentional golden refresh that preserves lint-clean semantics red-gates recovery cases.

## Decision ledger

- Recovered plan subspec landing asserts staged-markdown lint-clean property (or routes through the shared staged-markdown fixture registry), not byte equality with a committed golden path; rules out red-gates on golden bytes that still satisfy MD012-clean semantics.
- Deferred to first consumer: whether recovery cases share one helper with `daemon-pipeline-recover.test.ts` — pin when a caller needs it.

## Task checklist

- [ ] Re-key audit row `dm-pipe-recovery-plan-fixture` per the decision ledger.
- [ ] Replace golden `readFileSync` byte oracle in `recoverPipelineBranchStage` fixtures with lint-contract or registry-backed assertion for the landed subspec body.

## Acceptance criteria

- [ ] `pipeline-stage-recovery.test.ts` test `recovers a corrected non-first fan-out branch and leaves siblings unchanged` asserts the landed plan subspec satisfies the staged-markdown lint contract, not byte equality with `execution/fixtures/write-loop-staged-markdown-lint/plan-md012-clean-subspec.md`; it fails against the pre-fix `setup.correctedBody` golden bytes on audit row `dm-pipe-recovery-plan-fixture` and passes after re-key.
- [ ] `bun run typecheck` passes.

## Documentation updates

None — patterns land in `v2/docs/test-writing.md` via a later intent.
