import { describe, expect, test } from "bun:test";
import { loadPromptRegistry } from "../../shared/prompts/api.ts";
import { renderWriteExecutePrompt } from "./write-prompt.ts";

describe("write prompt", () => {
  test("registers stable id write.execute", () => {
    const registry = loadPromptRegistry();
    expect(registry.getById("write.execute").metadata.id).toBe("write.execute");
  });

  test("renders through shared registry contract", () => {
    const rendered = renderWriteExecutePrompt({
      specPath: "spec/example/index.md",
      stepRules: "Follow the contract.",
    });

    expect(rendered).toContain("Read the spec at spec/example/index.md.");
    expect(rendered).toContain("Follow the contract.");
  });
});
