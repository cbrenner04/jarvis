---
name: retire-mutate-dsl-from-default-write-step-rules
---

# Retire `@mutate`/guard-inversion lines from default write-step rules

Unsplit rationale: Removing the retired checkpoint-authoring lines from the canonical `DEFAULT_WRITE_STEP_RULES` source and retiring the consumer-side `filterPlanDraftStepRules` shim are one shared write-step-rules contract change; intent-split, plan-draft, implement, and v1 patch prompts all read the same constant.

## Primary implementation surface

- Shared write-step-rules prompt corpus (`shared/prompts/step-rules.ts` and its consumers)

## Prerequisites

- The `@mutate`/checkpoint DSL processor is retired with no live write-loop selection or verification of comment checkpoints.
- Plan draft and implement prompts already omit guard-inversion and `@mutate` placement lines via `filterPlanDraftStepRules` on main.

## Problem

- `retire-mutation-checkpoint-dsl` removed the live processor but left two retired-DSL lines in `DEFAULT_WRITE_STEP_RULES`; plan-draft and implement filter them while intent-split injects the raw constant, so fresh ready-intents re-emit dead `// @mutate` checkpoint directives into acceptance criteria.

## Behavior

- `DEFAULT_WRITE_STEP_RULES` carries human-only markers, invert-hook prohibition, and terminal tokens only — no guard-inversion checkpoint paragraph and no `@mutate` placement rule.
- `filterPlanDraftStepRules` and its call sites are removed; plan-draft and implement assembly stay observably identical to today's filtered output.
- `IMPLEMENT_WRITE_STEP_RULES` still appends `KILLING_TEST_RULE` after the cleaned default rules.
- Intent-split step-completion injection matches the cleaned constant with no checkpoint-authoring lines.

## Decision ledger

- Delete the guard-inversion and `@mutate` placement lines from `DEFAULT_WRITE_STEP_RULES` at source; rules out patching each consumer to filter.
- Retire `filterPlanDraftStepRules` once the source is clean; rules out a permanent filter that hides stale source bytes.
- Keep `KILLING_TEST_RULE` on the implement path; rules out removing the live diff-derived-gate authoring contract.

## Acceptance criteria

- [ ] `shared/prompts/step-rules.test.ts` asserts `DEFAULT_WRITE_STEP_RULES` contains neither `@mutate` nor `Guard-inversion criteria require`; it fails against the pre-fix constant.
- [ ] `shared/prompts/intent-split.test.ts` asserts the assembled intent prompt's `## Step completion` section contains no `@mutate` or guard-inversion line; it fails against the pre-fix intent assembly.
- [ ] `IMPLEMENT_WRITE_STEP_RULES` still ends with `KILLING_TEST_RULE`, and `shared/prompts/plan-draft.test.ts` checkpoint-filter cases stay green with observably identical plan-draft step-rules output.
- [ ] `v2/src/execution/write.test.ts` implement and plan-draft step-rules pins stay green after filter retirement.
- [ ] If `DEFAULT_WRITE_STEP_RULES` bytes change, refresh v1 rendered snapshot fixtures and run `bun run test:v1`.
- [ ] `bun run typecheck`, `bun run test:shared`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — remove checkpoint-authoring filter description from implement write-step rules; state the source constant is already clean.
- `v2/docs/workflow-runner.md` — remove lingering `@mutate`/guard-inversion authoring from the write-step-rules contract.
- `v2/docs/v1-behaviors.md` — record that default write-step rules no longer mandate checkpoint authoring syntax.
