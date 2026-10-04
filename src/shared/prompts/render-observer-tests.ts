/** Registry-relative `prompts/...` path → repo-relative observer test files for `bun test`. */
const RENDER_OBSERVER_TESTS: Readonly<Record<string, readonly string[]>> = {
  "prompts/global/documentation.md": ["src/execution/write-prompt.test.ts"],
  "prompts/global/naming.md": ["src/execution/write-prompt.test.ts"],
  "prompts/global/no-hard-wrap.md": ["src/execution/write-prompt.test.ts", "src/shared/prompts/intent-split.test.ts"],
  "prompts/global/terse.md": ["src/execution/write-prompt.test.ts", "src/shared/prompts/intent-split.test.ts"],
  "prompts/implement/review-adjudicator.md": [
    "src/shared/prompts/review-implement.test.ts",
    "src/shared/prompts/review-implement-contract-preservation.test.ts",
    "src/shared/prompts/review-implement-growth-budget.test.ts",
  ],
  "prompts/implement/review-adversary.md": [
    "src/shared/prompts/review-implement.test.ts",
    "src/shared/prompts/review-implement-contract-preservation.test.ts",
    "src/shared/prompts/review-implement-growth-budget.test.ts",
    "src/shared/prompts/review-falsifiability-fragment.test.ts",
  ],
  "prompts/implement/review-advocate.md": [
    "src/shared/prompts/review-implement.test.ts",
    "src/shared/prompts/review-implement-contract-preservation.test.ts",
    "src/shared/prompts/review-implement-growth-budget.test.ts",
    "src/shared/prompts/review-falsifiability-fragment.test.ts",
  ],
  "prompts/implement/review-critic.md": [
    "src/shared/prompts/review-implement.test.ts",
    "src/shared/prompts/review-implement-contract-preservation.test.ts",
    "src/shared/prompts/review-implement-growth-budget.test.ts",
    "src/shared/prompts/review-falsifiability-fragment.test.ts",
  ],
  "prompts/implement/review-falsifiability.md": [
    "src/shared/prompts/review-falsifiability-fragment.test.ts",
    "src/shared/prompts/review-implement.test.ts",
    "src/shared/prompts/review-plan-falsifiability.test.ts",
  ],
  "prompts/intent/review-adjudicator.md": ["src/shared/prompts/review-profile.test.ts"],
  "prompts/intent/review-advocate.md": ["src/shared/prompts/review-profile.test.ts"],
  "prompts/intent/review-adversary.md": ["src/shared/prompts/review-profile.test.ts"],
  "prompts/intent/split.md": [
    "src/shared/prompts/intent-split.test.ts",
    "src/execution/intent-split-regression.test.ts",
  ],
  "prompts/implement/instructions.md": ["src/execution/write-prompt.test.ts"],
  "prompts/implement/rules.md": ["src/execution/write-prompt.test.ts", "src/shared/prompts/review-implement.test.ts"],
  "prompts/implement/shrink.md": ["src/execution/write-prompt.test.ts"],
  "prompts/plan/decisions-ledger.md": ["src/shared/prompts/cross-path-render.test.ts"],
  "prompts/plan/draft.md": ["src/shared/prompts/plan-draft.test.ts", "src/execution/write-prompt.test.ts"],
  "prompts/plan/review-adjudicator.md": [
    "src/shared/prompts/review-plan-contract-preservation.test.ts",
    "src/shared/prompts/review-plan-growth-budget.test.ts",
  ],
  "prompts/plan/review-adversary.md": [
    "src/shared/prompts/review-plan-contract-preservation.test.ts",
    "src/shared/prompts/review-plan-growth-budget.test.ts",
    "src/shared/prompts/review-plan-premise-falsification.test.ts",
    "src/shared/prompts/review-plan-hollow-pin.test.ts",
    "src/shared/prompts/review-falsifiability-fragment.test.ts",
    "src/shared/prompts/review-plan-falsifiability.test.ts",
  ],
  "prompts/plan/review-advocate.md": [
    "src/shared/prompts/review-plan-contract-preservation.test.ts",
    "src/shared/prompts/review-plan-growth-budget.test.ts",
    "src/shared/prompts/review-plan-premise-falsification.test.ts",
    "src/shared/prompts/review-plan-hollow-pin.test.ts",
    "src/shared/prompts/review-falsifiability-fragment.test.ts",
    "src/shared/prompts/review-plan-falsifiability.test.ts",
  ],
  "prompts/plan/review-actuator.md": [
    "src/shared/prompts/review-plan-contract-preservation.test.ts",
    "src/shared/prompts/review-plan-growth-budget.test.ts",
  ],
  "prompts/plan/review-critic.md": [
    "src/shared/prompts/review-profile.test.ts",
    "src/shared/prompts/review-plan-contract-preservation.test.ts",
    "src/shared/prompts/review-plan-growth-budget.test.ts",
    "src/shared/prompts/review-plan-premise-falsification.test.ts",
    "src/shared/prompts/review-plan-hollow-pin.test.ts",
    "src/shared/prompts/review-falsifiability-fragment.test.ts",
    "src/shared/prompts/review-plan-falsifiability.test.ts",
  ],
  "prompts/review-feedback/write.md": ["src/shared/prompts/review-feedback-write.test.ts"],
  "prompts/review-feedback/rules.md": ["src/shared/prompts/review-feedback-write.test.ts"],
  "prompts/write/execute.md": ["src/execution/write-prompt.test.ts"],
  "prompts/write/draft-contract-reprompt.md": ["src/execution/write-loop.test.ts"],
  "prompts/write/gate-budget-reprompt.md": ["src/execution/write-prompt.test.ts"],
  "prompts/write/guard-checkpoint-reprompt.md": ["src/execution/write-prompt.test.ts"],
  "prompts/write/surviving-mutation-reprompt.md": ["src/execution/write-prompt.test.ts"],
  "prompts/write/mutation-repair.md": ["src/execution/write-prompt.test.ts"],
  "prompts/write/ready-repair.md": ["src/execution/write.test.ts"],
};

export function resolveRenderObserverTests(promptPath: string): readonly string[] | undefined {
  return RENDER_OBSERVER_TESTS[promptPath];
}
