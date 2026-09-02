import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { loadPromptRegistry } from "./registry.ts";

export const PLAN_REVIEW_ADVERSARY_BASELINE_BODY_LENGTH = 2392;
export const PLAN_REVIEW_ADVOCATE_BASELINE_BODY_LENGTH = 2232;
export const PLAN_REVIEW_ADJUDICATOR_BASELINE_BODY_LENGTH = 2893;
export const PLAN_REVIEW_CRITIC_BASELINE_BODY_LENGTH = 2312;
export const PLAN_REVIEW_ACTUATOR_BASELINE_BODY_LENGTH = 2513;

const PLAN_REVIEW_ROLE_BASELINES: Readonly<Record<string, number>> = {
  "plan.prompt.review.adversary": PLAN_REVIEW_ADVERSARY_BASELINE_BODY_LENGTH,
  "plan.prompt.review.advocate": PLAN_REVIEW_ADVOCATE_BASELINE_BODY_LENGTH,
  "plan.prompt.review.adjudicator": PLAN_REVIEW_ADJUDICATOR_BASELINE_BODY_LENGTH,
  "plan.prompt.review.critic": PLAN_REVIEW_CRITIC_BASELINE_BODY_LENGTH,
  "plan.prompt.review-actuator": PLAN_REVIEW_ACTUATOR_BASELINE_BODY_LENGTH,
};

export const PLAN_REVIEW_ROLE_PLACEHOLDERS: Readonly<Record<string, string>> = {
  "plan.prompt.review.adversary":
    "[WORKDIR:string!, NAME:string!, INTENT:string!, CURRENT_SPEC:string!, SPEC_GUIDANCE:string!, REVIEW_PASS_CONTEXT:string!]",
  "plan.prompt.review.advocate":
    "[WORKDIR:string!, NAME:string!, INTENT:string!, CURRENT_SPEC:string!, SPEC_GUIDANCE:string!, ADVERSARY_FINDINGS:string!, REVIEW_PASS_CONTEXT:string!]",
  "plan.prompt.review.adjudicator":
    "[WORKDIR:string!, NAME:string!, INTENT:string!, CURRENT_SPEC:string!, SPEC_GUIDANCE:string!, ADVOCATE_RESPONSE:string!, REVIEW_PASS_CONTEXT:string!]",
  "plan.prompt.review.critic":
    "[WORKDIR:string!, NAME:string!, INTENT:string!, CURRENT_SPEC:string!, SPEC_GUIDANCE:string!, REVIEW_PASS_CONTEXT:string!]",
  "plan.prompt.review-actuator":
    "[WORKDIR:string!, NAME:string!, INTENT:string!, CURRENT_SPEC:string!, SPEC_GUIDANCE:string!, VERDICT:string!, TARGET_DIR:string!]",
};

function readPlaceholdersField(sourcePath: string): string {
  const raw = readFileSync(sourcePath, "utf8");
  const endIndex = raw.indexOf("\n---\n", 4);
  if (endIndex === -1) throw new Error(`unterminated frontmatter in ${sourcePath}`);
  for (const line of raw.slice(4, endIndex).split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("placeholders:")) {
      return trimmed.slice("placeholders:".length).trim();
    }
  }
  throw new Error(`missing placeholders in ${sourcePath}`);
}

describe("plan review role growth budget", () => {
  const registry = loadPromptRegistry();

  test("plan review role body growth stays within budget", () => {
    for (const [id, baseline] of Object.entries(PLAN_REVIEW_ROLE_BASELINES)) {
      const bodyLength = registry.getById(id).body.length;
      expect(bodyLength).toBeLessThan(baseline);
    }
  });

  test("plan review role placeholders unchanged", () => {
    for (const [id, expected] of Object.entries(PLAN_REVIEW_ROLE_PLACEHOLDERS)) {
      const artifact = registry.getById(id);
      expect(readPlaceholdersField(artifact.sourcePath)).toBe(expected);
    }
  });
});
