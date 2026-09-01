import { describe, expect, test } from "bun:test";
import { loadPromptRegistry } from "../../../../shared/prompts/registry.ts";
import { buildReviewPrompt } from "./review.ts";

describe("buildReviewPrompt layout variants", () => {
  test("ignores layout variants absent from the review artifact", () => {
    const opts = { name: "x", intent: "i", specGuidance: "g", currentSpec: "spec" };
    const defaultPrompt = buildReviewPrompt(opts);

    expect(buildReviewPrompt({ ...opts, flatSpecLayout: true })).toBe(defaultPrompt);
    expect(buildReviewPrompt({ ...opts, targetDir: "v1/spec" })).toBe(defaultPrompt);
  });

  test("selects flat-layout when flatSpecLayout is set and the artifact declares the variant", () => {
    const artifact = loadPromptRegistry().getById("plan.prompt.review.adversary");
    const originalVariants = artifact.metadata.variants;
    artifact.metadata.variants = {
      ...originalVariants,
      "flat-layout": [{ anchor: "missing review layout anchor", replacement: "replacement" }],
    };

    try {
      expect(() =>
        buildReviewPrompt({
          name: "x",
          intent: "i",
          specGuidance: "g",
          currentSpec: "spec",
          flatSpecLayout: true,
        }),
      ).toThrow(
        "review prompt configuration error: Variant `flat-layout` substitution: template anchor `missing review layout anchor` is missing from body",
      );
    } finally {
      artifact.metadata.variants = originalVariants;
    }
  });

  test("selects nested-target-dir only when targetDir is not the default spec root", () => {
    const artifact = loadPromptRegistry().getById("plan.prompt.review.adversary");
    const originalVariants = artifact.metadata.variants;
    artifact.metadata.variants = {
      ...originalVariants,
      "nested-target-dir": [{ anchor: "missing nested layout anchor", replacement: "replacement" }],
    };

    const base = { name: "x", intent: "i", specGuidance: "g", currentSpec: "spec" };

    try {
      expect(() => buildReviewPrompt({ ...base, targetDir: "v1/spec" })).toThrow(
        "review prompt configuration error: Variant `nested-target-dir` substitution: template anchor `missing nested layout anchor` is missing from body",
      );
      expect(() => buildReviewPrompt(base)).not.toThrow();
    } finally {
      artifact.metadata.variants = originalVariants;
    }
  });

  test("prefers flat-layout over nested-target-dir when both would apply", () => {
    const artifact = loadPromptRegistry().getById("plan.prompt.review.adversary");
    const originalVariants = artifact.metadata.variants;
    artifact.metadata.variants = {
      ...originalVariants,
      "flat-layout": [{ anchor: "missing flat precedence anchor", replacement: "replacement" }],
      "nested-target-dir": [{ anchor: "missing nested precedence anchor", replacement: "replacement" }],
    };

    try {
      expect(() =>
        buildReviewPrompt({
          name: "x",
          intent: "i",
          specGuidance: "g",
          currentSpec: "spec",
          flatSpecLayout: true,
          targetDir: "v1/spec",
        }),
      ).toThrow(
        "review prompt configuration error: Variant `flat-layout` substitution: template anchor `missing flat precedence anchor` is missing from body",
      );
    } finally {
      artifact.metadata.variants = originalVariants;
    }
  });
});
