# Re-key workflow-runner-review.test.ts golden fixtures

## Problem

Row `ex-wrr-review-fixture-golden` in `v2/docs/structural-invariant-test-audit.md` pins review staged-markdown-lint reprompt cases to repeated `readFileSync(join(REVIEW_MD_LINT_FIXTURES, ...))` literals for violation and clean golden bodies, so fixture path drift passes vacuously until a case reads a missing file.

## Decision ledger

- Review reprompt golden bytes load through shared staged-markdown-lint fixture helpers keyed by committed fixture ids on `REVIEW_MD_LINT_FIXTURES`, not per-case path string literals; rules out duplicated `plan-md038-violation-subspec.md` joins across reprompt scenarios.
- Golden bytes remain the committed fixtures under `fixtures/write-loop-staged-markdown-lint/`; rules out copying golden markdown into test string literals.
- Missing fixture paths fail through loud-failure locators; rules out silent empty reads when a golden file moves.

## Task checklist

- [ ] Re-key audit row `ex-wrr-review-fixture-golden` per the decision ledger.
- [ ] Replace scattered golden `readFileSync` calls with shared fixture-id helpers.
- [ ] Route fixture discovery through loud-failure locators.

## Acceptance criteria

- [ ] `v2/src/execution/workflow-runner-review.test.ts` review staged-markdown-lint reprompt cases load violation and clean golden bodies through shared fixture helpers rather than repeated `readFileSync` path literals; it fails against the pre-fix scattered fixture joins and passes after re-key.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

None — patterns land in `v2/docs/test-writing.md` via a later intent.
