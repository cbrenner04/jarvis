import { describe, expect, test } from "bun:test";
import { loadPromptRegistry } from "../../../../shared/prompts/registry.ts";
import { buildVerdictActuatorPrompt } from "./verdict-actuator.ts";

const base = {
  name: "x",
  intent: "i",
  specGuidance: "g",
  currentSpec: "spec",
  verdict: "Apply the verdict.",
};

describe("buildVerdictActuatorPrompt layout variants", () => {
  test("selects flat-layout when flatSpecLayout is set and the artifact declares the variant", () => {
    const artifact = loadPromptRegistry().getById("plan.prompt.review-actuator");
    const originalVariants = artifact.metadata.variants;
    artifact.metadata.variants = {
      ...originalVariants,
      "flat-layout": [{ anchor: "missing review actuator layout anchor", replacement: "replacement" }],
    };

    try {
      expect(() =>
        buildVerdictActuatorPrompt({
          ...base,
          flatSpecLayout: true,
        }),
      ).toThrow(
        "review actuator prompt configuration error: Variant `flat-layout` substitution: template anchor `missing review actuator layout anchor` is missing from body",
      );
    } finally {
      artifact.metadata.variants = originalVariants;
    }
  });

  test("selects nested-target-dir only when targetDir is not the default spec root", () => {
    const artifact = loadPromptRegistry().getById("plan.prompt.review-actuator");
    const originalVariants = artifact.metadata.variants;
    artifact.metadata.variants = {
      ...originalVariants,
      "nested-target-dir": [{ anchor: "missing nested layout anchor", replacement: "replacement" }],
    };

    try {
      expect(() => buildVerdictActuatorPrompt({ ...base, targetDir: "v1/spec" })).toThrow(
        "review actuator prompt configuration error: Variant `nested-target-dir` substitution: template anchor `missing nested layout anchor` is missing from body",
      );
      expect(() => buildVerdictActuatorPrompt(base)).not.toThrow();
    } finally {
      artifact.metadata.variants = originalVariants;
    }
  });

  test("prefers flat-layout over nested-target-dir when both would apply", () => {
    const artifact = loadPromptRegistry().getById("plan.prompt.review-actuator");
    const originalVariants = artifact.metadata.variants;
    artifact.metadata.variants = {
      ...originalVariants,
      "flat-layout": [{ anchor: "missing flat precedence anchor", replacement: "replacement" }],
      "nested-target-dir": [{ anchor: "missing nested precedence anchor", replacement: "replacement" }],
    };

    try {
      expect(() =>
        buildVerdictActuatorPrompt({
          ...base,
          flatSpecLayout: true,
          targetDir: "v1/spec",
        }),
      ).toThrow(
        "review actuator prompt configuration error: Variant `flat-layout` substitution: template anchor `missing flat precedence anchor` is missing from body",
      );
    } finally {
      artifact.metadata.variants = originalVariants;
    }
  });
});
