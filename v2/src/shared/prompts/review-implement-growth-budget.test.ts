import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { locateFrontmatterField } from "../structural-test-locator.ts";
import { loadPromptRegistry } from "./registry.ts";
import type { PromptPlaceholderDeclaration } from "./types.ts";

export const IMPLEMENT_REVIEW_CRITIC_BASELINE_BODY_LENGTH = 1842;
export const IMPLEMENT_REVIEW_ADVERSARY_BASELINE_BODY_LENGTH = 1627;
export const IMPLEMENT_REVIEW_ADVOCATE_BASELINE_BODY_LENGTH = 1792;
export const IMPLEMENT_REVIEW_ADJUDICATOR_BASELINE_BODY_LENGTH = 2433;

const IMPLEMENT_REVIEW_ROLE_IDS = [
  "implement.prompt.review.critic",
  "implement.prompt.review.adversary",
  "implement.prompt.review.advocate",
  "implement.prompt.review.adjudicator",
] as const;

function baselineBodyLengthFor(id: (typeof IMPLEMENT_REVIEW_ROLE_IDS)[number]): number {
  switch (id) {
    case "implement.prompt.review.critic":
      return IMPLEMENT_REVIEW_CRITIC_BASELINE_BODY_LENGTH;
    case "implement.prompt.review.adversary":
      return IMPLEMENT_REVIEW_ADVERSARY_BASELINE_BODY_LENGTH;
    case "implement.prompt.review.advocate":
      return IMPLEMENT_REVIEW_ADVOCATE_BASELINE_BODY_LENGTH;
    case "implement.prompt.review.adjudicator":
      return IMPLEMENT_REVIEW_ADJUDICATOR_BASELINE_BODY_LENGTH;
  }
}

function formatPlaceholders(declarations: readonly PromptPlaceholderDeclaration[]): string {
  return `[${declarations.map((declaration) => `${declaration.name}:${declaration.type}${declaration.required ? "!" : ""}`).join(", ")}]`;
}

describe("implement review role growth budget", () => {
  const registry = loadPromptRegistry();

  test("implement review role body growth stays within budget", () => {
    for (const id of IMPLEMENT_REVIEW_ROLE_IDS) {
      const bodyLength = registry.getById(id).body.length;
      expect(bodyLength).toBeLessThan(baselineBodyLengthFor(id));
    }
  });

  test("implement review role placeholders unchanged", () => {
    for (const id of IMPLEMENT_REVIEW_ROLE_IDS) {
      const artifact = registry.getById(id);
      expect(
        locateFrontmatterField(readFileSync(artifact.sourcePath, "utf8"), "placeholders", artifact.sourcePath),
      ).toBe(formatPlaceholders(artifact.metadata.placeholders));
    }
  });
});
