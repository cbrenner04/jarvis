import { describe, expect, test } from "bun:test";
import {
  buildEffectivePromptAgentEntries,
  parsePromptAgentFlagValue,
} from "../src/prompt-agent-override.ts";

const CONFIG_ORDER = [
  { agent: "claude" as const, model: "haiku" },
  { agent: "cursor" as const, model: "Composer 2.5" },
];

describe("parsePromptAgentFlagValue", () => {
  test("parses agent without model", () => {
    expect(parsePromptAgentFlagValue("opencode")).toEqual({
      ok: true,
      pin: { agent: "opencode" },
    });
  });

  test("parses agent with inline model", () => {
    expect(parsePromptAgentFlagValue("codex:gpt-5.3-codex")).toEqual({
      ok: true,
      pin: { agent: "codex", inlineModel: "gpt-5.3-codex" },
    });
  });

  test("rejects unknown agent", () => {
    const result = parsePromptAgentFlagValue("bogus");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("bogus");
      expect(result.message).toContain("claude");
    }
  });

  test("rejects empty agent name", () => {
    const result = parsePromptAgentFlagValue(":model");
    expect(result.ok).toBe(false);
  });
});

describe("buildEffectivePromptAgentEntries", () => {
  test("pins absent agent first with default model", () => {
    expect(buildEffectivePromptAgentEntries({ agent: "opencode" }, CONFIG_ORDER)).toEqual([
      { agent: "opencode", model: "opencode/deepseek-v4-flash-free" },
      { agent: "claude", model: "haiku" },
      { agent: "cursor", model: "Composer 2.5" },
    ]);
  });

  test("dedupes agent already in config order", () => {
    expect(
      buildEffectivePromptAgentEntries({ agent: "claude", inlineModel: "sonnet" }, CONFIG_ORDER),
    ).toEqual([
      { agent: "claude", model: "sonnet" },
      { agent: "cursor", model: "Composer 2.5" },
    ]);
  });

  test("pinned-only when config order empty", () => {
    expect(buildEffectivePromptAgentEntries({ agent: "cursor" }, [])).toEqual([
      { agent: "cursor", model: "Composer 2.5" },
    ]);
  });

  test("--model overrides config but loses to inline model", () => {
    expect(
      buildEffectivePromptAgentEntries(
        { agent: "claude", inlineModel: "sonnet", cliModel: "haiku" },
        CONFIG_ORDER,
      ),
    ).toEqual([{ agent: "claude", model: "sonnet" }, { agent: "cursor", model: "Composer 2.5" }]);
  });
});
