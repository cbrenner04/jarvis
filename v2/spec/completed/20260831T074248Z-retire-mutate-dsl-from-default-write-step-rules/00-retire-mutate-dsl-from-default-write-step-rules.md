# Clean default write-step rules and retire filter

## Problem

- `retire-mutation-checkpoint-dsl` removed the live processor but left two retired-DSL lines in `DEFAULT_WRITE_STEP_RULES`; plan-draft and implement filter them while intent-split injects the raw constant, so fresh ready-intents re-emit dead `// @mutate` checkpoint directives into acceptance criteria.
- `filterPlanDraftStepRules` also rewrites `Do not split \`@mutate\` directives…` in `prompts/global/no-hard-wrap.md` on assembled plan-draft, review, and actuator templates; deleting the filter without cleaning that fragment reintroduces `@mutate` into those prompts.
- v1 patch, shrink, and repair paths inject raw `DEFAULT_WRITE_STEP_RULES` (never filtered); cleaning the constant removes checkpoint-authoring instructions from those prompts too.

## Behavior

- `DEFAULT_WRITE_STEP_RULES` carries human-only markers, invert-hook prohibition, and terminal tokens only — no guard-inversion checkpoint paragraph and no `@mutate` placement rule.
- `prompts/global/no-hard-wrap.md` line 11 is exactly `Do not split acceptance-criterion checkboxes across physical lines.` with no `@mutate` reference.
- `filterPlanDraftStepRules` and its call sites are removed; plan-draft, implement, review, and actuator assembly stay observably identical to today's filtered output.
- `IMPLEMENT_WRITE_STEP_RULES` is `${DEFAULT_WRITE_STEP_RULES}\n${KILLING_TEST_RULE}` with no filter import or call on that path.
- Intent-split step-completion injection matches the cleaned constant with no checkpoint-authoring lines.

## Decision ledger

- Delete the guard-inversion and `@mutate` placement lines from `DEFAULT_WRITE_STEP_RULES` at source; rules out patching each consumer to filter step rules.
- Edit `prompts/global/no-hard-wrap.md` to the exact checkbox-only line above; rules out keeping `filterPlanDraftStepRules` as a narrower assembled-template transform.
- Retire `filterPlanDraftStepRules` once both sources are clean; rules out a permanent filter that hides stale bytes.
- Keep `KILLING_TEST_RULE` on the implement path; rules out removing the live diff-derived-gate authoring contract.

## Tasks

- Remove the guard-inversion checkpoint paragraph and `@mutate` placement rule from `shared/prompts/step-rules.ts` `DEFAULT_WRITE_STEP_RULES`; keep human-only markers, invert-hook prohibition, and terminal tokens.
- Change `prompts/global/no-hard-wrap.md` line 11 to `Do not split acceptance-criterion checkboxes across physical lines.`; bump `revision` when bytes change.
- Delete `filterPlanDraftStepRules`, `MUTATE_DIRECTIVE_LINE`, and `CHECKBOX_LINE` from `shared/prompts/plan-draft.ts`; remove filter calls from both `buildPlanDraftPrompt` sites (assembled-template assembly and optional `## Step completion` suffix) and from `shared/prompts/review-plan.ts`, `v2/src/execution/write-loop-input.ts`, `v1/src/modes/plan/review.ts`, and `v1/src/modes/plan/verdict-actuator.ts`.
- Wire `IMPLEMENT_WRITE_STEP_RULES` to `${DEFAULT_WRITE_STEP_RULES}\n${KILLING_TEST_RULE}` with no filter shim.
- Replace `shared/prompts/step-rules.test.ts` placement assertions with absence guards for `@mutate` and `Guard-inversion criteria require`.
- Update `shared/prompts/intent-split.test.ts`: assert `## Step completion` has no checkpoint-authoring lines and the full assembled prompt `not.toContain("@mutate")` (covers `global.no-hard-wrap` leak path).
- Add or extend plan-review assembly coverage (`shared/prompts/review-plan.ts` / `review-profile.test.ts`) asserting rendered plan-review output `not.toContain("@mutate")`.
- Update `shared/prompts/plan-draft.test.ts` and `v2/src/execution/write.test.ts` pins that reference `filterPlanDraftStepRules` to expect the cleaned constant directly.
- Refresh `v1/test/fixtures/prompts/rendered/**` snapshots when `DEFAULT_WRITE_STEP_RULES` or `no-hard-wrap.md` bytes change.
- Align durable docs listed below.

## Acceptance criteria

- [x] `shared/prompts/step-rules.test.ts` asserts `DEFAULT_WRITE_STEP_RULES` contains neither `@mutate` nor `Guard-inversion criteria require`; it fails against the pre-fix constant.
- [x] `shared/prompts/intent-split.test.ts` asserts the assembled intent prompt's `## Step completion` section contains no `@mutate` or guard-inversion line and the full assembled prompt `not.toContain("@mutate")`; it fails against the pre-fix intent assembly (including the `global.no-hard-wrap` leak path).
- [x] `prompts/global/no-hard-wrap.md` line 11 is exactly `Do not split acceptance-criterion checkboxes across physical lines.` with no `@mutate` wording; `loadPromptRegistry().getById("global.no-hard-wrap").metadata.revision` increments from the pre-fix value.
- [x] `shared/prompts/plan-draft.test.ts` test `renders named pre-fix failing-test guidance without checkpoint authoring` still asserts the full assembled prompt `not.toContain("@mutate")`; it fails against the pre-fix fragment when the filter is removed without cleaning `no-hard-wrap.md`.
- [x] `shared/prompts/plan-draft.test.ts` test `appends file output and step completion sections when supplied` stays green with observably identical plan-draft step-rules output after filter retirement.
- [x] Plan-review rendered output (dedicated test on `renderPlanReviewCriticPrompt` or equivalent) `not.toContain("@mutate")`; it fails against the pre-fix review assembly when the filter is removed without cleaning `no-hard-wrap.md`.
- [x] `v2/src/execution/write-loop-input.ts` exports `IMPLEMENT_WRITE_STEP_RULES` as `${DEFAULT_WRITE_STEP_RULES}\n${KILLING_TEST_RULE}` with no `filterPlanDraftStepRules` import or call on that path.
- [x] `v2/src/execution/write.test.ts` implement prompt test (`patch.prompt.body` path with `not.toContain("Place \`// @mutate\`")` and `not.toContain("comment checkpoint on the pinning test")`) stays green.
- [x] `v2/src/execution/write.test.ts` plan-draft and implement step-rules pins stay green.
- [x] After `DEFAULT_WRITE_STEP_RULES` or `no-hard-wrap.md` bytes change: refresh `v1/test/fixtures/prompts/rendered/**` snapshots and `bun run test:v1` passes, including `v1/test/prompt.test.ts` verbatim `DEFAULT_WRITE_STEP_RULES` expectation and `v2/src/execution/write.test.ts` `patch.prompt.shrink renders DEFAULT_WRITE_STEP_RULES as final block`.
- [x] `bun run typecheck` passes.
- [x] `bun run test:shared` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.
- [x] `v2/docs/write-behavior.md` replaces checkpoint-authoring filter prose with source-is-clean wording for implement write-step rules.
- [x] `v2/docs/workflow-runner.md` replaces filtered-step-rules and checkpoint-authoring catalog entries with source-is-clean, filter-removed wording.
- [x] `v2/docs/v1-behaviors.md` records that v1 patch/shrink/repair prompts no longer inject checkpoint-authoring syntax via raw `DEFAULT_WRITE_STEP_RULES`, and replaces filter-centric catalog entries with source-is-clean wording.

## Documentation updates

- `v2/docs/write-behavior.md` — remove checkpoint-authoring filter description from implement write-step rules; state the source constant is already clean.
- `v2/docs/workflow-runner.md` — remove lingering `@mutate`/guard-inversion authoring and filtered-step-rules catalog entries from the write-step-rules contract.
- `v2/docs/v1-behaviors.md` — record that v1 patch/shrink/repair paths inject cleaned default write-step rules with no checkpoint-authoring syntax; replace filter-centric catalog entries.
- `v1/docs/prompt-governance.md` — align the `global.no-hard-wrap` fragment description with the checkbox-only line (no `@mutate` reference).
