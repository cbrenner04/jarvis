import { describe, expect, test } from "bun:test";
import { loadPromptRegistry } from "./registry.ts";

const ADVERSARY_IDENTIFY_LIST_MARKERS = [
  "Missing acceptance criteria or incomplete task descriptions",
  "Gaps in the decision record",
  "Architectural or design risks",
  "Edge cases or scenarios not addressed",
  "Spec violations of the guidance conventions",
] as const;

describe("plan review role contract preservation", () => {
  const registry = loadPromptRegistry();

  test("plan review role contract substrings preserved", () => {
    const adversary = registry.getById("plan.prompt.review.adversary").body;
    const advocate = registry.getById("plan.prompt.review.advocate").body;
    const adjudicator = registry.getById("plan.prompt.review.adjudicator").body;
    const critic = registry.getById("plan.prompt.review.critic").body;
    const actuator = registry.getById("plan.prompt.review-actuator").body;

    expect(adversary).toContain(
      "Structural **product** acceptance criteria that mandate files, modules, tables, or shapes when structure is not the contract",
    );
    expect(adversary).toContain("do not treat prose compression as a remedy");

    expect(advocate).toContain("For each adversary concern:");
    expect(advocate).toContain("Do not defend prose compression as a split");

    expect(adjudicator).toContain("Self-contained: the actuator reads only your verdict");
    expect(adjudicator).toContain("issue an empty verdict (no content)");
    expect(adjudicator).toContain("do not prescribe prose compression");

    expect(actuator).toContain("Rewrite structural **product**");
    expect(actuator).toContain("do not compress prose instead of splitting");

    expect(critic).toContain("editorial review");
    expect(critic).toContain("Do not critique technical correctness");
    for (const marker of ADVERSARY_IDENTIFY_LIST_MARKERS) {
      expect(critic).not.toContain(marker);
    }
  });
});
