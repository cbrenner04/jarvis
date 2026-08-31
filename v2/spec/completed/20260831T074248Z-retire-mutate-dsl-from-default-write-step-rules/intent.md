---
name: retire-mutate-dsl-from-default-write-step-rules
---

# Retire `@mutate`/guard-inversion lines from default write-step rules

Unsplit rationale: Removing the retired checkpoint-authoring lines from `DEFAULT_WRITE_STEP_RULES`, cleaning the global `no-hard-wrap` fragment, and retiring the consumer-side `filterPlanDraftStepRules` shim are one shared write-step-rules contract change; intent-split, plan-draft, implement, review, and v1 patch prompts all read the same corpus.

## Primary implementation surface

- Shared write-step-rules prompt corpus (`shared/prompts/step-rules.ts`, `prompts/global/no-hard-wrap.md`, and their consumers)

## Prerequisites

- The `@mutate`/checkpoint DSL processor is retired with no live write-loop selection or verification of comment checkpoints.
- Plan draft, implement, review, and actuator templates already omit guard-inversion and `@mutate` placement lines via `filterPlanDraftStepRules` on main; that filter also rewrites the global `no-hard-wrap` `@mutate` line to checkbox-only on assembled templates.

## Problem

- `retire-mutation-checkpoint-dsl` removed the live processor but left two retired-DSL lines in `DEFAULT_WRITE_STEP_RULES`; plan-draft and implement filter them while intent-split injects the raw constant, so fresh ready-intents re-emit dead `// @mutate` checkpoint directives into acceptance criteria.
- `filterPlanDraftStepRules` also rewrites `Do not split \`@mutate\` directives…` in `prompts/global/no-hard-wrap.md` on assembled plan-draft, review, and actuator templates; deleting the filter without cleaning that fragment reintroduces `@mutate` into those prompts.

## Behavior

- `DEFAULT_WRITE_STEP_RULES` carries human-only markers, invert-hook prohibition, and terminal tokens only — no guard-inversion checkpoint paragraph and no `@mutate` placement rule.
- `prompts/global/no-hard-wrap.md` carries checkbox-only wording (`Do not split acceptance-criterion checkboxes…`) with no `@mutate` reference.
- `filterPlanDraftStepRules` and its call sites are removed; plan-draft, implement, review, and actuator assembly stay observably identical to today's filtered output.
- `IMPLEMENT_WRITE_STEP_RULES` still appends `KILLING_TEST_RULE` after the cleaned default rules.
- Intent-split step-completion injection matches the cleaned constant with no checkpoint-authoring lines.

## Decision ledger

- Delete the guard-inversion and `@mutate` placement lines from `DEFAULT_WRITE_STEP_RULES` at source; rules out patching each consumer to filter step rules.
- Edit `prompts/global/no-hard-wrap.md` to drop `@mutate` from the checkbox line; rules out keeping `filterPlanDraftStepRules` as a narrower assembled-template transform.
- Retire `filterPlanDraftStepRules` once both sources are clean; rules out a permanent filter that hides stale bytes (seed's keep-filter-when-another-line-needs-stripping fork resolves to deletion — no other retired line remains).
- Keep `KILLING_TEST_RULE` on the implement path; rules out removing the live diff-derived-gate authoring contract.

## Acceptance criteria

- [ ] `shared/prompts/step-rules.test.ts` asserts `DEFAULT_WRITE_STEP_RULES` contains neither `@mutate` nor `Guard-inversion criteria require`; it fails against the pre-fix constant.
- [ ] `shared/prompts/intent-split.test.ts` asserts the assembled intent prompt's `## Step completion` section contains no `@mutate` or guard-inversion line; it fails against the pre-fix intent assembly.
- [ ] `prompts/global/no-hard-wrap.md` contains no `@mutate` wording, and `shared/prompts/plan-draft.test.ts` `renders named pre-fix failing-test guidance without checkpoint authoring` still asserts the full assembled prompt `not.toContain("@mutate")`; it fails against the pre-fix fragment.
- [ ] `IMPLEMENT_WRITE_STEP_RULES` still ends with `KILLING_TEST_RULE`, and `shared/prompts/plan-draft.test.ts` step-rules checkpoint-filter cases stay green with observably identical plan-draft step-rules output.
- [ ] `v2/src/execution/write.test.ts` implement and plan-draft step-rules pins stay green after filter retirement.
- [ ] If `DEFAULT_WRITE_STEP_RULES` or `no-hard-wrap.md` bytes change, refresh v1 rendered snapshot fixtures and run `bun run test:v1`.
- [ ] `bun run typecheck`, `bun run test:shared`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — remove checkpoint-authoring filter description from implement write-step rules; state the source constant is already clean.
- `v2/docs/workflow-runner.md` — remove lingering `@mutate`/guard-inversion authoring from the write-step-rules contract.
- `v2/docs/v1-behaviors.md` — record that default write-step rules no longer mandate checkpoint authoring syntax.
