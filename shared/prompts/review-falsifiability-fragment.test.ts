import { describe, expect, test } from "bun:test";
import { loadPromptRegistry } from "./registry.ts";

const FALSIFIABILITY_FRAGMENT_ID = "implement.review.falsifiability";

const FALSIFIABILITY_GUIDANCE_MARKERS = [
  "would fail against the pre-change code implied by the branch diff context",
  "would pass before and after the change as a finding in itself",
  "re-derives the production rule instead of asserting the intended outcome independently",
] as const;

const IMPLEMENT_REVIEW_FALSIFIABILITY_STEP_IDS = [
  "implement.prompt.review.critic",
  "implement.prompt.review.adversary",
  "implement.prompt.review.advocate",
] as const;

describe("implement review falsifiability fragment", () => {
  const registry = loadPromptRegistry();

  test("implement review falsifiability guidance is defined only on the shared fragment", () => {
    const fragmentBody = registry.getById(FALSIFIABILITY_FRAGMENT_ID).body;
    for (const marker of FALSIFIABILITY_GUIDANCE_MARKERS) {
      expect(fragmentBody).toContain(marker);
    }
    for (const stepId of IMPLEMENT_REVIEW_FALSIFIABILITY_STEP_IDS) {
      const stepBody = registry.getById(stepId).body;
      for (const marker of FALSIFIABILITY_GUIDANCE_MARKERS) {
        expect(stepBody).not.toContain(marker);
      }
    }
  });

  test("review falsifiability fragment has no project-specific identifiers", () => {
    const body = registry.getById(FALSIFIABILITY_FRAGMENT_ID).body;
    expect(body).not.toMatch(/\bjarvis\b/i);
    expect(body).not.toMatch(/\bv2\//);
    expect(body).not.toMatch(/\bshared\//);
    expect(body).not.toMatch(/\bprompts\//);
    expect(body).not.toMatch(/#\d+/);
  });
});
