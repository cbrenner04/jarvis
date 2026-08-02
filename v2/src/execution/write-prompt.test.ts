import { describe, expect, test } from "bun:test";
import { loadPromptRegistry } from "../../../shared/prompts/registry.ts";
import { PromptRenderingError } from "../../../shared/prompts/render.ts";
import { DEFAULT_WRITE_STEP_RULES } from "../../../shared/prompts/step-rules.ts";
import { renderStepPrompt } from "./write-prompt.ts";

const HUMAN_ONLY_STEP_RULES =
  "Human-only acceptance criteria contain `(Manual)`, `visual inspection only`, or `no automated guard` anywhere in the full bullet block (the first checklist line and any continuation lines). Recognition uses case-insensitive substring matching; markers need not be trailing or whole phrases.";

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

  test("write.execute isolates the shared human-only step rules", () => {
    const principles = "MARKER_FREE_PRINCIPLES";
    const rendered = renderStepPrompt("write.execute", {
      SPEC_PATH: "spec/example/index.md",
      PRINCIPLES: principles,
      STEP_RULES: DEFAULT_WRITE_STEP_RULES,
    });
    const stepRules = rendered.slice(rendered.indexOf(DEFAULT_WRITE_STEP_RULES));

    expect(rendered).toContain(principles);
    expect(stepRules).toBe(DEFAULT_WRITE_STEP_RULES);
    expect(stepRules).toContain(HUMAN_ONLY_STEP_RULES);
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

  test("unknown prompt id surfaces the registry lookup error", () => {
    expect(() => renderStepPrompt("no.such.prompt", {})).toThrow(/unknown prompt id/);
  });

  test("missing a required declared placeholder surfaces the render layer's error", () => {
    expect(() => renderStepPrompt("write.execute", { SPEC_PATH: "spec.md" })).toThrow(PromptRenderingError);
  });
});
