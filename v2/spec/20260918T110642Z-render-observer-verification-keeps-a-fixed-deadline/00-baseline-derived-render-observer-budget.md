# 00 — Baseline-derived render-observer budget

## Problem

`verifyPromptRenderCoverage` (`v2/src/execution/diff-derived-mutation-verifier.ts`) calls `runScopedTests` without options on both the exempt/clean and mutated paths, so both use the fixed `MAX_KILLING_TEST_MS` (30s). An observer slower than 30s unmutated (e.g. `write-loop.test.ts`, 35.67s) deterministically settles `nonTerminatingRenderObserverMutation` (`render-observer-timeout`) → `non_terminating_mutation_failed`, `nextAction: "resume"`; resume replays the same bound.

## Decisions

- Reuse the killing-test path's `baselineFor` / `killingTestBudgetMs` / `runMutatedKillingSet` mechanism for observer runs; no second timing policy or constant. The `baselineFor` measurement is the clean-observer check (no second clean run); only the mutated call takes the baseline-derived `timeoutMs`.
- A clean observer run past `KILLING_TEST_BUDGET_CEILING_MS` (or unmeasurable before the deadline) settles the prompt inconclusive and allows publication, matching `inconclusiveCandidateReason`; not `missing-render-coverage`, not `render-observer-timeout`.
- `render-observer-timeout` is reported only when the mutated run times out under a budget derived from a measured baseline; a timing-only outcome must not settle `non_terminating_mutation_failed` / `nextAction: "resume"`.
- Out of scope: observer map, `MAX_PROMPT_RENDER_VERIFICATIONS`, killing-test resolution.

## Task checklist

- [ ] Thread the baseline measurer into `verifyPromptRenderCoverage`; use the `baselineFor` measurement as the clean-observer check (no second clean run); pass baseline-derived `timeoutMs` only on the mutated observer call.
- [ ] Add the inconclusive observer settlement.
- [ ] Tests and docs below.

## Acceptance criteria

- [ ] A `diff-derived-mutation-verifier.test.ts` regression stubs `runScopedTests` to return timeout iff `timeoutMs` < a simulated 35s observer duration, with the clock injected via `now()`, and asserts the changed registered prompt settles passed (not failed, not inconclusive); it fails against the pre-fix no-options call.
- [ ] A regression asserts the mutated render-observer call's `timeoutMs` equals `killingTestBudgetMs(measured)`.
- [ ] A regression proves an observer whose clean run exceeds `KILLING_TEST_BUDGET_CEILING_MS` settles inconclusive and allows publication; a second case proves the same when the baseline returns `{kind:"deadline"}`.
- [ ] A regression proves an observer that passes within budget unmutated but times out under mutation still settles `render-observer-timeout` / `non_terminating_mutation_failed`, distinguishable from the inconclusive timing settlement.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — Diff-derived mutation verification: render-observer budget is baseline-derived; slow clean observer settles inconclusive.
- `v2/docs/operator-runbook.md` — Gate trust: `render-observer-timeout` means a mutant hung under a measured budget; pre-fix settlements on slow observers cannot be cleared by resume.
