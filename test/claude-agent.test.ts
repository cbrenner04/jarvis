import { describe, expect, test } from "bun:test";
import { ClaudeAgent } from "../src/agents/claude.ts";

describe("ClaudeAgent", () => {
  test("constructs with a configured model", () => {
    const agent = new ClaudeAgent({ model: "haiku" });
    expect(agent).toBeTruthy();
  });

  test("attribution label includes model", () => {
    const agent = new ClaudeAgent({ model: "claude-opus-4-7" });
    const label = agent.attributionLabel();
    expect(label).toContain("Claude Opus 4.7");
  });

  test("attribution label works with default model", () => {
    const agent = new ClaudeAgent();
    const label = agent.attributionLabel();
    expect(label).toContain("claude");
    expect(label).toContain("default model");
  });
});
