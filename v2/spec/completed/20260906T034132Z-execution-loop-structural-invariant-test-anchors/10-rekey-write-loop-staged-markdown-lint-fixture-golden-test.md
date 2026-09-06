# Re-key write-loop-staged-markdown-lint.test.ts golden fixtures

## Problem

Row `ex-wlsl-fixture-golden` in `v2/docs/structural-invariant-test-audit.md` pins plan/intent staged-markdown-lint cases to a local `FIXTURES_DIR` constant and repeated per-case `readFileSync` filename literals, duplicating the staged-markdown-lint fixture registry already shared with workflow-runner tests.

## Decision ledger

- Fixture directory and golden ids resolve through the shared staged-markdown-lint fixture registry (`REVIEW_MD_LINT_FIXTURES` / co-located helper), not a test-local `FIXTURES_DIR` duplicate; rules out parallel fixture roots that drift when the harness moves fixture trees.
- Golden bytes remain committed markdown under `fixtures/write-loop-staged-markdown-lint/` loaded by fixture id; rules out inlining golden bodies as string literals.
- Missing fixtures throw via loud-failure locators; rules out silent failures when a golden filename changes.

## Task checklist

- [x] Re-key audit row `ex-wlsl-fixture-golden` per the decision ledger.
- [x] Replace local `FIXTURES_DIR` usage with shared fixture registry helpers.
- [x] Route golden loads through loud-failure fixture reads keyed by committed ids.

## Acceptance criteria

- [x] `v2/src/execution/write-loop-staged-markdown-lint.test.ts` plan/intent staged Markdown lint cases load golden and violation bytes through shared staged-markdown-lint fixture helpers rather than a local `FIXTURES_DIR` and repeated filename literals; it fails against the pre-fix duplicated fixture root and passes after re-key.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

None — patterns land in `v2/docs/test-writing.md` via a later intent.
