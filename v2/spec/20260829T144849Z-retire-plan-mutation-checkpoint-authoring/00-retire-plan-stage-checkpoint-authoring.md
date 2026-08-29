# Retire plan-stage checkpoint authoring

## Problem

- Plan prompts and guidance require checkpoint syntax before implementation creates the tests and source anchors, producing hollow or stale contracts that need operator repair.
- Plan review and normalization reinforce that retired authoring contract through hollow-pin findings and keystone-shape rejection.

## Decision ledger

- Filter checkpoint-only lines from plan-draft step rules while leaving implement prompts and completion verification unchanged; rules out breaking previously authored trees during the drain interval.
- Retire plan-stage checkpoint-DSL authoring (`Mutation checkpoint:`, `@mutate` in AC bullets, guard-inversion checkpoint paragraphs in plan step rules) separately from implement-time “invert each added/modified guard” policy — plan draft stops instructing subspec authors to carry guard-inversion AC bullets; this change’s own guards remain covered by inversion tests.
- Remove hollow-pin review injection, keystone-shape normalization, and their plan-only helpers together; rules out retaining plan-stage validators for syntax Jarvis no longer authors.
- Accept no new checkpoint hardening during the drain interval; rules out extending machinery scheduled for separate retirement.

## Tasks

- Introduce filtered plan-draft step rules that keep human-only markers, production invert-hook prohibition, and response-token rules while dropping checkpoint-authoring lines (guard-inversion checkpoint paragraph and `@mutate` placement); wire `buildPlanDraftPrompt` and `prompts/plan/draft.md` through the filter; implement write prompts continue receiving full `DEFAULT_WRITE_STEP_RULES` unchanged.
- Revise `prompts/plan/draft.md` and `shared/prompts/plan-draft.ts` so rendered drafts retain the named pre-fix failing-test rule without requiring checkpoint-DSL authoring or emitting checkpoint labels/directives from supplied default step rules.
- Update `shared/prompts/plan-draft.test.ts` (including cases that assert guard-inversion body text or raw `DEFAULT_WRITE_STEP_RULES` equality), prompt revisions, and rendered fixtures to pin the filtered draft contract against real spec guidance and default step-rules input; update `v2/src/execution/write.test.ts` intent-seed / `expectGuardInversionWriteStepRules` paths to assert filtered plan-draft rules, not raw checkpoint mandates.
- Remove hollow-pin collection and formatting from `shared/prompts/review-plan.ts`, remove the adversary's `## At-risk hollow pins` instruction, and update `shared/prompts/review-plan-hollow-pin.test.ts`, `shared/prompts/review-plan-premise-falsification.test.ts` (composition and hollow-only branches), prompt revisions, and rendered fixtures while preserving premise-falsification context.
- Remove keystone-shape rejection from `normalizePlanDraftSpecDir`; delete plan-only helpers `detectAtRiskHollowPinsInMarkdown`, `formatAtRiskHollowPinsSection`, and `findUnsatisfiableKeystoneCriteria` (or equivalent) and their hollow-pin detector tests from `shared/mutation-checkpoint-criteria.ts` and `shared/mutation-checkpoint-criteria.test.ts`; replace keystone-shape refusal coverage in `shared/module-boundary-surfaces.test.ts` with admission coverage; preserve index-link and module-boundary validation; keep implement-time selection, verification, and `isCheckpointTestFileReference` in force during the drain.
- Keep implementation-time checkpoint selection, verification, repair, and legacy authored-tree compatibility out of scope except for preservation verification.
- Align the durable guidance listed below in the same change; when trimming `v1/docs/spec-guidance.md` mutation-checkpoint authoring, retain pinning-test reachability rules under behavioral AC or rule-out/invariant guidance for premise-falsification.

## Acceptance criteria

- [ ] `shared/prompts/plan-draft.test.ts` test `renders named pre-fix failing-test guidance without checkpoint authoring` renders the draft with real spec guidance and default step rules, requires a named test that fails before the fix and passes afterward, and rejects checkpoint-authoring and plan-stage guard-inversion mandates; it fails against the pre-fix prompt.
- [ ] `shared/prompts/plan-draft.test.ts` cases that previously asserted guard-inversion body text or raw `DEFAULT_WRITE_STEP_RULES` equality instead assert the filtered plan-draft step-rules block; `v2/src/execution/write.test.ts` intent-seed / `expectGuardInversionWriteStepRules` paths assert filtered plan-draft rules, not raw checkpoint mandates.
- [ ] `shared/prompts/review-plan-hollow-pin.test.ts` test `does not inject hollow-pin findings into plan review` proves a formerly flagged criterion adds no hollow-pin context; it fails against the pre-fix review path.
- [ ] `shared/prompts/review-plan-premise-falsification.test.ts` proves premise-falsification context still renders for unfalsifiable premises, hollow-pin sections never appear in review pass context, and composition tests no longer reference `## At-risk hollow pins`; it fails against the pre-fix composition path.
- [ ] `shared/module-boundary-surfaces.test.ts` test `admits keystone-shaped criteria during draft normalization` proves keystone-shape refusal is absent, keystone-shaped criteria are admitted, and broken index links still fail; it fails against the pre-fix normalizer.
- [ ] `shared/mutation-checkpoint-criteria.test.ts` drops hollow-pin detector assertions while retaining implement-time selector coverage.
- [ ] Rendered plan draft and review prompts (including the review adversary template with no `## At-risk hollow pins` instruction), `revision:` bumps on changed templates, and `v1/docs/spec-guidance.md` carry no checkpoint-authoring labels or directive syntax, while the named pre-fix failing-test requirement and rule-out/invariant reachability guidance remain.
- [ ] Implement write prompts still receive full `DEFAULT_WRITE_STEP_RULES` unchanged; rendered plan draft lacks checkpoint mandates.
- [ ] `mutation-checkpoint-verifier.test.ts`, `mutation-checkpoint-keystone.test.ts`, `v2/test/mutation-checkpoint-regression.test.ts`, and `write.test.ts` checkpoint arms stay green; operator docs state the drain interval and forbid new plan-stage checkpoint hardening (hollow-pin detectors, keystone normalizers, plan-stage checkpoint validators).
- [ ] Any added or modified guard in this change is covered by a test that fails when the guard is inverted (implement-time inversion policy for this spec’s guards, not plan-stage checkpoint-DSL authoring); negative cases prove suppressed effects are absent.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v1/docs/spec-guidance.md` — remove checkpoint authoring and plan-stage guard-inversion requirements while retaining named pre-fix failing-test guidance and rule-out/invariant reachability rules.
- `v1/docs/operator-runbook.md` — record plan-authoring retirement, legacy-tree drain sequencing, and the no-new-hardening rule.
- `v2/docs/workflow-runner.md` — remove the plan-authored keystone and draft-normalization contracts.
- `v2/docs/test-writing.md` — remove plan-time checkpoint authoring, pin-classifier-for-review, and keystone-shape draft contracts while preserving implement-time verification guidance still in force during the drain.
- `v2/docs/v1-behaviors.md` — record retirement of the plan-stage guard-inversion mandate, hollow-pin review injection, and keystone draft rejection while preserving the implementation-time verifier entry until its separate retirement.
- `v2/docs/operator-runbook.md` — remove plan-debate hollow-pin injection guidance.
- `v2/docs/write-behavior.md` — remove draft keystone refusal guidance.
