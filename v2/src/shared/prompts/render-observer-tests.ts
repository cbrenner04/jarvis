/** Registry-relative `prompts/...` path → repo-relative observer test files for `bun test`. */
const RENDER_OBSERVER_TESTS: Readonly<Record<string, readonly string[]>> = {
  "prompts/global/documentation.md": ["v2/src/execution/write-prompt.test.ts"],
  "prompts/global/naming.md": ["v2/src/execution/write-prompt.test.ts"],
  "prompts/global/no-hard-wrap.md": [
    "v2/src/execution/write-prompt.test.ts",
    "v2/src/shared/prompts/intent-split.test.ts",
  ],
  "prompts/global/terse.md": ["v2/src/execution/write-prompt.test.ts", "v2/src/shared/prompts/intent-split.test.ts"],
  "prompts/implement/review-adjudicator.md": [
    "v2/src/shared/prompts/review-implement.test.ts",
    "v2/src/shared/prompts/review-implement-contract-preservation.test.ts",
    "v2/src/shared/prompts/review-implement-growth-budget.test.ts",
  ],
  "prompts/implement/review-adversary.md": [
    "v2/src/shared/prompts/review-implement.test.ts",
    "v2/src/shared/prompts/review-implement-contract-preservation.test.ts",
    "v2/src/shared/prompts/review-implement-growth-budget.test.ts",
    "v2/src/shared/prompts/review-falsifiability-fragment.test.ts",
  ],
  "prompts/implement/review-advocate.md": [
    "v2/src/shared/prompts/review-implement.test.ts",
    "v2/src/shared/prompts/review-implement-contract-preservation.test.ts",
    "v2/src/shared/prompts/review-implement-growth-budget.test.ts",
    "v2/src/shared/prompts/review-falsifiability-fragment.test.ts",
  ],
  "prompts/implement/review-critic.md": [
    "v2/src/shared/prompts/review-implement.test.ts",
    "v2/src/shared/prompts/review-implement-contract-preservation.test.ts",
    "v2/src/shared/prompts/review-implement-growth-budget.test.ts",
    "v2/src/shared/prompts/review-falsifiability-fragment.test.ts",
  ],
  "prompts/implement/review-falsifiability.md": [
    "v2/src/shared/prompts/review-falsifiability-fragment.test.ts",
    "v2/src/shared/prompts/review-implement.test.ts",
    "v2/src/shared/prompts/review-plan-falsifiability.test.ts",
  ],
  "prompts/intent/review-adjudicator.md": ["v2/src/shared/prompts/review-profile.test.ts"],
  "prompts/intent/review-advocate.md": ["v2/src/shared/prompts/review-profile.test.ts"],
  "prompts/intent/review-adversary.md": ["v2/src/shared/prompts/review-profile.test.ts"],
  "prompts/intent/split.md": [
    "v2/src/shared/prompts/intent-split.test.ts",
    "v2/src/execution/intent-split-regression.test.ts",
  ],
  "prompts/implement/instructions.md": ["v2/src/execution/write-prompt.test.ts"],
  "prompts/implement/rules.md": [
    "v2/src/execution/write-prompt.test.ts",
    "v2/src/shared/prompts/review-implement.test.ts",
  ],
  "prompts/implement/shrink.md": ["v2/src/execution/write-prompt.test.ts"],
  "prompts/plan/decisions-ledger.md": ["v2/src/shared/prompts/cross-path-render.test.ts"],
  "prompts/plan/draft.md": ["v2/src/shared/prompts/plan-draft.test.ts", "v2/src/execution/write-prompt.test.ts"],
  "prompts/plan/review-adjudicator.md": [
    "v2/src/shared/prompts/review-plan-contract-preservation.test.ts",
    "v2/src/shared/prompts/review-plan-growth-budget.test.ts",
  ],
  "prompts/plan/review-adversary.md": [
    "v2/src/shared/prompts/review-plan-contract-preservation.test.ts",
    "v2/src/shared/prompts/review-plan-growth-budget.test.ts",
    "v2/src/shared/prompts/review-plan-premise-falsification.test.ts",
    "v2/src/shared/prompts/review-plan-hollow-pin.test.ts",
    "v2/src/shared/prompts/review-falsifiability-fragment.test.ts",
    "v2/src/shared/prompts/review-plan-falsifiability.test.ts",
  ],
  "prompts/plan/review-advocate.md": [
    "v2/src/shared/prompts/review-plan-contract-preservation.test.ts",
    "v2/src/shared/prompts/review-plan-growth-budget.test.ts",
    "v2/src/shared/prompts/review-plan-premise-falsification.test.ts",
    "v2/src/shared/prompts/review-plan-hollow-pin.test.ts",
    "v2/src/shared/prompts/review-falsifiability-fragment.test.ts",
    "v2/src/shared/prompts/review-plan-falsifiability.test.ts",
  ],
  "prompts/plan/review-actuator.md": [
    "v2/src/shared/prompts/review-plan-contract-preservation.test.ts",
    "v2/src/shared/prompts/review-plan-growth-budget.test.ts",
  ],
  "prompts/plan/review-critic.md": [
    "v2/src/shared/prompts/review-profile.test.ts",
    "v2/src/shared/prompts/review-plan-contract-preservation.test.ts",
    "v2/src/shared/prompts/review-plan-growth-budget.test.ts",
    "v2/src/shared/prompts/review-plan-premise-falsification.test.ts",
    "v2/src/shared/prompts/review-plan-hollow-pin.test.ts",
    "v2/src/shared/prompts/review-falsifiability-fragment.test.ts",
    "v2/src/shared/prompts/review-plan-falsifiability.test.ts",
  ],
  "prompts/review-feedback/write.md": ["v2/src/shared/prompts/review-feedback-write.test.ts"],
  "prompts/review-feedback/rules.md": ["v2/src/shared/prompts/review-feedback-write.test.ts"],
  "prompts/write/execute.md": ["v2/src/execution/write-prompt.test.ts"],
  "prompts/write/draft-contract-reprompt.md": ["v2/src/execution/write-loop.test.ts"],
  "prompts/write/gate-budget-reprompt.md": ["v2/src/execution/write-prompt.test.ts"],
  "prompts/write/guard-checkpoint-reprompt.md": ["v2/src/execution/write-prompt.test.ts"],
  "prompts/write/surviving-mutation-reprompt.md": ["v2/src/execution/write-prompt.test.ts"],
  "prompts/write/mutation-repair.md": ["v2/src/execution/write-prompt.test.ts"],
  "prompts/write/ready-repair.md": ["v2/src/execution/write.test.ts"],
};

export function resolveRenderObserverTests(promptPath: string): readonly string[] | undefined {
  return RENDER_OBSERVER_TESTS[promptPath];
}
