import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { loadPromptRegistry } from "./registry.ts";

export const IMPLEMENT_REVIEW_CRITIC_BASELINE_BODY_LENGTH = 1842;
export const IMPLEMENT_REVIEW_ADVERSARY_BASELINE_BODY_LENGTH = 1627;
export const IMPLEMENT_REVIEW_ADVOCATE_BASELINE_BODY_LENGTH = 1792;
export const IMPLEMENT_REVIEW_ADJUDICATOR_BASELINE_BODY_LENGTH = 2433;

const IMPLEMENT_REVIEW_ROLE_BASELINES: Readonly<Record<string, number>> = {
  "implement.prompt.review.critic": IMPLEMENT_REVIEW_CRITIC_BASELINE_BODY_LENGTH,
  "implement.prompt.review.adversary": IMPLEMENT_REVIEW_ADVERSARY_BASELINE_BODY_LENGTH,
  "implement.prompt.review.advocate": IMPLEMENT_REVIEW_ADVOCATE_BASELINE_BODY_LENGTH,
  "implement.prompt.review.adjudicator": IMPLEMENT_REVIEW_ADJUDICATOR_BASELINE_BODY_LENGTH,
};

export const IMPLEMENT_REVIEW_ROLE_PLACEHOLDERS: Readonly<Record<string, string>> = {
  "implement.prompt.review.critic":
    "[SPEC_PATH:string!, SPEC_TREE:string!, BRANCH_DIFF:string!, REVIEW_PASS_NUMBER:string!, REVIEW_PASS_CONTEXT:string!]",
  "implement.prompt.review.adversary":
    "[SPEC_PATH:string!, SPEC_TREE:string!, BRANCH_DIFF:string!, REVIEW_PASS_NUMBER:string!, REVIEW_PASS_CONTEXT:string!]",
  "implement.prompt.review.advocate":
    "[SPEC_PATH:string!, SPEC_TREE:string!, BRANCH_DIFF:string!, ADVERSARY_FINDINGS:string!, REVIEW_PASS_NUMBER:string!, REVIEW_PASS_CONTEXT:string!]",
  "implement.prompt.review.adjudicator":
    "[SPEC_PATH:string!, SPEC_TREE:string!, BRANCH_DIFF:string!, ADVOCATE_RESPONSE:string!, REVIEW_PASS_NUMBER:string!, REVIEW_PASS_CONTEXT:string!]",
};

export function readPlaceholdersField(sourcePath: string): string {
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

describe("implement review role growth budget", () => {
  const registry = loadPromptRegistry();

  test("implement review role body growth stays within budget", () => {
    for (const [id, baseline] of Object.entries(IMPLEMENT_REVIEW_ROLE_BASELINES)) {
      const bodyLength = registry.getById(id).body.length;
      expect(bodyLength).toBeLessThan(baseline);
    }
  });

  test("implement review role placeholders unchanged", () => {
    for (const [id, expected] of Object.entries(IMPLEMENT_REVIEW_ROLE_PLACEHOLDERS)) {
      const artifact = registry.getById(id);
      expect(readPlaceholdersField(artifact.sourcePath)).toBe(expected);
    }
  });
});
