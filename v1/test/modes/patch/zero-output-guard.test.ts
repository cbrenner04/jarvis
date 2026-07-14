import { describe, expect, test } from "bun:test";
import { harnessZeroAgentOutputLine } from "../../../src/quota-harness-messages.ts";

describe("zero-output guard messages", () => {
  test("formats agent name in the harness message", () => {
    const msg = harnessZeroAgentOutputLine("claude");
    expect(msg).toContain("claude");
    expect(msg).toContain("zero agent output observed");
  });

  test("formats different agent names", () => {
    const claudeMsg = harnessZeroAgentOutputLine("claude");
    const cursorMsg = harnessZeroAgentOutputLine("cursor");
    expect(claudeMsg).not.toEqual(cursorMsg);
    expect(cursorMsg).toContain("cursor");
  });
});
