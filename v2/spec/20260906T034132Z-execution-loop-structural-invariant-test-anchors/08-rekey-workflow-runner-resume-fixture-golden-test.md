# Re-key workflow-runner-resume.test.ts golden fixtures

## Problem

Row `ex-wrr-resume-fixture-golden` in `v2/docs/structural-invariant-test-audit.md` pins recoverPlanStage and mutation-repair golden bodies to scattered `readFileSync(join(REVIEW_MD_LINT_FIXTURES, ...))` calls, so fixture renames or path drift fail loudly only when assertions happen to touch a stale binding.

## Decision ledger

- Staged-markdown-lint golden bytes load through the shared `REVIEW_MD_LINT_FIXTURES` registry in `workflow-runner.test-support.ts` with loud-failure fixture reads keyed by committed fixture ids; rules out ad-hoc `join(..., "plan-md012-clean-subspec.md")` strings repeated per case.
- Golden fixture bytes remain the committed markdown under `fixtures/write-loop-staged-markdown-lint/` as the source of truth for expected bodies; rules out inlining golden prose as string literals in the test.
- Fixture lookup failures throw through `locateDiscoveredFile` / shared loud-failure helpers; rules out `readFileSync` returning undefined paths that later assert empty strings.

## Task checklist

- [ ] Re-key audit row `ex-wrr-resume-fixture-golden` per the decision ledger.
- [ ] Centralize golden fixture loads through shared fixture-id helpers on `REVIEW_MD_LINT_FIXTURES`.
- [ ] Route missing-fixture paths through loud-failure locators.

## Acceptance criteria

- [ ] `v2/src/execution/workflow-runner-resume.test.ts` recoverPlanStage and mutation-repair golden cases load expected bodies through shared staged-markdown-lint fixture helpers rather than scattered `readFileSync` path literals; it fails against the pre-fix ad-hoc fixture path strings and passes after re-key.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

None — patterns land in `v2/docs/test-writing.md` via a later intent.
