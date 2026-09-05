import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { locateMarkerSlice } from "../structural-test-locator.ts";
import { loadPromptRegistry } from "./registry.ts";
import type { PromptPlaceholderDeclaration } from "./types.ts";

export const PLAN_REVIEW_ADVERSARY_BASELINE_BODY_LENGTH = 2392;
export const PLAN_REVIEW_ADVOCATE_BASELINE_BODY_LENGTH = 2232;
export const PLAN_REVIEW_ADJUDICATOR_BASELINE_BODY_LENGTH = 2893;
export const PLAN_REVIEW_CRITIC_BASELINE_BODY_LENGTH = 2312;
export const PLAN_REVIEW_ACTUATOR_BASELINE_BODY_LENGTH = 2513;

const PLAN_REVIEW_ROLE_IDS = [
  "plan.prompt.review.adversary",
  "plan.prompt.review.advocate",
  "plan.prompt.review.adjudicator",
  "plan.prompt.review.critic",
  "plan.prompt.review-actuator",
] as const;

function baselineBodyLengthFor(id: (typeof PLAN_REVIEW_ROLE_IDS)[number]): number {
  switch (id) {
    case "plan.prompt.review.adversary":
      return PLAN_REVIEW_ADVERSARY_BASELINE_BODY_LENGTH;
    case "plan.prompt.review.advocate":
      return PLAN_REVIEW_ADVOCATE_BASELINE_BODY_LENGTH;
    case "plan.prompt.review.adjudicator":
      return PLAN_REVIEW_ADJUDICATOR_BASELINE_BODY_LENGTH;
    case "plan.prompt.review.critic":
      return PLAN_REVIEW_CRITIC_BASELINE_BODY_LENGTH;
    case "plan.prompt.review-actuator":
      return PLAN_REVIEW_ACTUATOR_BASELINE_BODY_LENGTH;
  }
}

function formatPlaceholders(declarations: readonly PromptPlaceholderDeclaration[]): string {
  return `[${declarations.map((declaration) => `${declaration.name}:${declaration.type}${declaration.required ? "!" : ""}`).join(", ")}]`;
}

function readPlaceholdersField(sourcePath: string): string {
  const raw = readFileSync(sourcePath, "utf8");
  const frontmatter = locateMarkerSlice({
    text: raw,
    start: "---\n",
    end: "\n---\n",
    searchKey: `frontmatter in ${sourcePath}`,
  });
  return locateMarkerSlice({
    text: frontmatter,
    pattern: /^placeholders:\s*(.+)$/m,
    searchKey: `placeholders in ${sourcePath}`,
  }).trim();
}

describe("plan review role growth budget", () => {
  const registry = loadPromptRegistry();

  test("plan review role body growth stays within budget", () => {
    for (const id of PLAN_REVIEW_ROLE_IDS) {
      const bodyLength = registry.getById(id).body.length;
      expect(bodyLength).toBeLessThan(baselineBodyLengthFor(id));
    }
  });

  test("plan review role placeholders unchanged", () => {
    for (const id of PLAN_REVIEW_ROLE_IDS) {
      const artifact = registry.getById(id);
      expect(readPlaceholdersField(artifact.sourcePath)).toBe(formatPlaceholders(artifact.metadata.placeholders));
    }
  });
});
