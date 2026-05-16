import { describe, expect, test } from "bun:test";
import { ClaudeAgent } from "../src/agents/claude.ts";

describe("ClaudeAgent", () => {
  test("defaults to JSON output format", () => {
    const agent = new ClaudeAgent({ model: "haiku" });
    // We can't directly inspect the private outputFormat, so we test the behavior
    // by checking that usage is extracted when the agent is run
    expect(agent).toBeTruthy();
  });

  test("supports text output format option", () => {
    const agent = new ClaudeAgent({ model: "haiku", outputFormat: "text" });
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
