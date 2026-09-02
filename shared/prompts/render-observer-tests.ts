/** Registry-relative `prompts/...` path → repo-relative observer test files for `bun test`. */
const RENDER_OBSERVER_TESTS: Readonly<Record<string, readonly string[]>> = {
  "prompts/global/documentation.md": ["v2/src/execution/write-prompt.test.ts"],
  "prompts/global/naming.md": ["v2/src/execution/write-prompt.test.ts"],
  "prompts/global/no-hard-wrap.md": ["v2/src/execution/write-prompt.test.ts", "shared/prompts/intent-split.test.ts"],
  "prompts/global/terse.md": ["v2/src/execution/write-prompt.test.ts", "shared/prompts/intent-split.test.ts"],
  "prompts/implement/review-adjudicator.md": ["shared/prompts/review-implement.test.ts"],
  "prompts/implement/review-adversary.md": ["shared/prompts/review-implement.test.ts"],
  "prompts/implement/review-advocate.md": ["shared/prompts/review-implement.test.ts"],
  "prompts/implement/review-critic.md": ["shared/prompts/review-implement.test.ts"],
  "prompts/intent/review-adjudicator.md": ["shared/prompts/review-profile.test.ts"],
  "prompts/intent/review-advocate.md": ["shared/prompts/review-profile.test.ts"],
  "prompts/intent/review-adversary.md": ["shared/prompts/review-profile.test.ts"],
  "prompts/intent/split.md": [
    "shared/prompts/intent-split.test.ts",
    "v2/src/execution/intent-split-regression.test.ts",
  ],
  "prompts/patch/instructions.md": ["v2/src/execution/write-prompt.test.ts"],
  "prompts/patch/shrink.md": ["v2/src/execution/write-prompt.test.ts"],
  "prompts/plan/draft.md": ["shared/prompts/plan-draft.test.ts", "v2/src/execution/write-prompt.test.ts"],
  "prompts/plan/review-adjudicator.md": [
    "shared/prompts/review-plan-contract-preservation.test.ts",
    "shared/prompts/review-plan-growth-budget.test.ts",
  ],
  "prompts/plan/review-adversary.md": [
    "shared/prompts/review-plan-contract-preservation.test.ts",
    "shared/prompts/review-plan-growth-budget.test.ts",
    "shared/prompts/review-plan-premise-falsification.test.ts",
    "shared/prompts/review-plan-hollow-pin.test.ts",
  ],
  "prompts/plan/review-advocate.md": [
    "shared/prompts/review-plan-contract-preservation.test.ts",
    "shared/prompts/review-plan-growth-budget.test.ts",
    "shared/prompts/review-plan-premise-falsification.test.ts",
    "shared/prompts/review-plan-hollow-pin.test.ts",
  ],
  "prompts/plan/review-actuator.md": [
    "shared/prompts/review-plan-contract-preservation.test.ts",
    "shared/prompts/review-plan-growth-budget.test.ts",
    "v1/test/modes/plan/prompts.test.ts",
  ],
  "prompts/plan/review-critic.md": [
    "shared/prompts/review-profile.test.ts",
    "shared/prompts/review-plan-contract-preservation.test.ts",
    "shared/prompts/review-plan-growth-budget.test.ts",
    "shared/prompts/review-plan-premise-falsification.test.ts",
    "shared/prompts/review-plan-hollow-pin.test.ts",
  ],
  "prompts/write/execute.md": ["v2/src/execution/write-prompt.test.ts"],
  "prompts/write/guard-checkpoint-reprompt.md": ["v2/src/execution/write-prompt.test.ts"],
  "prompts/write/surviving-mutation-reprompt.md": ["v2/src/execution/write-prompt.test.ts"],
};

export function resolveRenderObserverTests(promptPath: string): readonly string[] | undefined {
  return RENDER_OBSERVER_TESTS[promptPath];
}
