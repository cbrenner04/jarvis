# Retired `@mutate`/guard-inversion DSL still ships in DEFAULT_WRITE_STEP_RULES → intent output re-contaminates every fresh ready-intent

## Problem

`retire-mutation-checkpoint-dsl` (brief chain, marked 4/4 complete) retired the `@mutate`/checkpoint DSL: there is no live processor (`v2/src/execution/write-loop-input.ts:12` states the rules must be "clear of the retired `@mutate`/checkpoint DSL"). But two retired-DSL lines still live in `DEFAULT_WRITE_STEP_RULES` (`shared/prompts/step-rules.ts`):

- `Guard-inversion criteria require a source mutation on the real guard and a comment checkpoint on the pinning test that names that mutation …`
- `Place \`// @mutate\` inside the enclosing test body …`

`filterPlanDraftStepRules` (`shared/prompts/plan-draft.ts`) exists solely to strip those two lines, and it is applied on the implement path (`IMPLEMENT_WRITE_STEP_RULES`) and plan-draft — so those stay clean. **The intent stage does not filter them**: `buildIntentSplitPrompt` injects the raw `DEFAULT_WRITE_STEP_RULES` (`shared/prompts/intent-split.ts` `stepRules`, asserted verbatim in `intent-split.test.ts`). So every fresh intent run authors ready-intent acceptance criteria carrying dead `// @mutate` checkpoint directives.

## Evidence (2026-08-30)

Four fresh intents run this session (#3177–#3180, clean prompts, post-retirement `main`); 3 of the 6 produced ready-intents carried `// @mutate` in their ACs — `resolve-importing-killing-tests`, `idle-timeout-checkpoint-resumability`, `idle-timeout-resume-admission`. These land dead directives into specs (the `#3165` hand-land had to scrub the same `@mutate` from stale ready-intents). The retire chain cleaned plan/implement authoring but left the intent path and the underlying `DEFAULT_WRITE_STEP_RULES` source carrying the retired lines.

## Decisions

- Delete the two retired-DSL lines (the "Guard-inversion criteria require …" line and the "Place // @mutate …" line) from `DEFAULT_WRITE_STEP_RULES` at the source, so no consumer re-emits them. Rules out patching each consumer to filter.
- With the source clean, retire `filterPlanDraftStepRules` (its only job is stripping those two lines) and its call sites, or keep it as a no-op-safe guard only if another retired line still needs stripping — prefer deletion. Rules out a permanent filter that hides the real fix.
- Keep the killing-test authoring rule (`KILLING_TEST_RULE`) — it is the live diff-derived-gate contract, not the retired DSL. Rules out over-deleting into the live coverage rule.

## Acceptance criteria

- [ ] `DEFAULT_WRITE_STEP_RULES` contains neither `@mutate` nor `Guard-inversion criteria require`; a `step-rules.test.ts` (or existing suite) asserts their absence and fails against the pre-fix constant.
- [ ] `intent-split.test.ts` asserts the assembled intent prompt's step-completion section contains no `@mutate` / guard-inversion line; it fails against the pre-fix intent assembly.
- [ ] `IMPLEMENT_WRITE_STEP_RULES` still ends with `KILLING_TEST_RULE`, and plan-draft assembly is unchanged in observable output (its filter now removes nothing, or is retired).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` / prompt docs — remove any lingering `@mutate`/guard-inversion authoring description from the write-step-rules contract.

## Sequencing

Prompt-corpus / mutation cleanup. Completes the `retire-mutation-checkpoint-dsl` chain's intent-path gap. Small; independent of the four mutation-gate P0 seeds. Until it lands, scrub `@mutate` from fresh ready-intents before planning them (as `#3165` did).
