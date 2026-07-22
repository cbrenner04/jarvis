import { describe, expect, test } from "bun:test";
import { loadPromptRegistry } from "../../../shared/prompts/registry.ts";
import { PromptRenderingError } from "../../../shared/prompts/render.ts";
import { renderStepPrompt } from "./write-prompt.ts";

describe("write prompt", () => {
  test("registers stable id write.execute", () => {
    const registry = loadPromptRegistry();
    expect(registry.getById("write.execute").metadata.id).toBe("write.execute");
  });

  test("renders through shared registry contract", () => {
    const rendered = renderStepPrompt("write.execute", {
      SPEC_PATH: "spec/example/index.md",
      PRINCIPLES: "",
      STEP_RULES: "Follow the contract.",
    });

    expect(rendered).toContain("Read the spec at spec/example/index.md.");
    expect(rendered).toContain("Follow the contract.");
  });

  test("renders an arbitrary registered prompt id from a caller-supplied placeholder map", () => {
    const rendered = renderStepPrompt("plan.prompt.draft", {
      WORKDIR: "/tmp/work",
      NAME: "example-spec",
      INTENT: "Do the thing.",
      SPEC_GUIDANCE: "Follow the guidance.",
    });

    expect(rendered).toContain("`/tmp/work`");
    expect(rendered).toContain("`example-spec`");
  });

  test("renders write.coverage-advisory with the coverage report body", () => {
    const report = "Uncovered changed lines:\n  src/foo.ts:10";
    const rendered = renderStepPrompt("write.coverage-advisory", {
      SPEC_PATH: "spec/example/index.md",
      STEP_RULES: "Return exactly one terminal token.",
      COVERAGE_REPORT: report,
    });

    expect(rendered).toContain(report);
    expect(rendered).toContain("mutation verifier");
    expect(rendered).toContain("optional and will not block");
  });

  test("unknown prompt id surfaces the registry lookup error", () => {
    expect(() => renderStepPrompt("no.such.prompt", {})).toThrow(/unknown prompt id/);
  });

  test("missing a required declared placeholder surfaces the render layer's error", () => {
    expect(() => renderStepPrompt("write.execute", { SPEC_PATH: "spec.md" })).toThrow(PromptRenderingError);
  });
});
