import { describe, expect, test } from "bun:test";
import { loadPromptRegistry } from "../../shared/prompts/registry.ts";
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

  test("renders all seven restraint principles", () => {
    const rendered = renderWriteExecutePrompt({
      specPath: "spec/example/index.md",
      stepRules: "Done.",
    });

    expect(rendered).toContain("Separate decision from effect");
    expect(rendered).toContain("No abstraction until two real callers");
    expect(rendered).toContain("Extend before you create");
    expect(rendered).toContain("No speculative configuration");
    expect(rendered).toContain("One module, one responsibility");
    expect(rendered).toContain("Data over branches");
    expect(rendered).toContain("Stay in scope");
  });
});
