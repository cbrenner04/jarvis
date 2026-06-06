import { describe, expect, test } from "bun:test";
import { agentHasPricedModels, resolveAgentPriceKey } from "../../src/agents/price-keys.ts";

describe("resolveAgentPriceKey", () => {
  test("claude maps short names to canonical price keys", () => {
    expect(resolveAgentPriceKey("claude", "haiku")).toBe("claude-haiku-4-5-20251001");
    expect(resolveAgentPriceKey("claude", "sonnet")).toBe("claude-sonnet-4-6");
    expect(resolveAgentPriceKey("claude", "opus")).toBe("claude-opus-4-8");
  });

  test("claude passes canonical price keys through unchanged", () => {
    expect(resolveAgentPriceKey("claude", "claude-opus-4-8")).toBe("claude-opus-4-8");
  });

  test("claude returns null for unknown models", () => {
    expect(resolveAgentPriceKey("claude", "haiko")).toBeNull();
    expect(resolveAgentPriceKey("claude", undefined)).toBeNull();
  });

  test("codex resolves known models and rejects unknown", () => {
    expect(resolveAgentPriceKey("codex", "gpt-5.3-codex")).toBe("gpt-5.3-codex");
    expect(resolveAgentPriceKey("codex", "gpt-5.5")).toBe("gpt-5.5");
    expect(resolveAgentPriceKey("codex", "gpt-5.4")).toBe("gpt-5.4");
    expect(resolveAgentPriceKey("codex", "gpt-5.2")).toBeNull();
  });

  test("opencode returns configured model unchanged and aider returns null", () => {
    expect(resolveAgentPriceKey("opencode", "anything")).toBe("anything");
    expect(resolveAgentPriceKey("opencode", undefined)).toBeNull();
    expect(resolveAgentPriceKey("aider", "anything")).toBeNull();
  });

  test("cursor identity-maps its known model menu", () => {
    expect(resolveAgentPriceKey("cursor", "Composer 2")).toBe("Composer 2");
    expect(resolveAgentPriceKey("cursor", "Claude 4.8 Opus")).toBe("Claude 4.8 Opus");
    expect(resolveAgentPriceKey("cursor", "not-a-cursor-model")).toBeNull();
  });
});

describe("agentHasPricedModels", () => {
  test("returns true only for agents with non-empty price-key maps", () => {
    expect(agentHasPricedModels("claude")).toBe(true);
    expect(agentHasPricedModels("codex")).toBe(true);
    expect(agentHasPricedModels("cursor")).toBe(true);
    expect(agentHasPricedModels("opencode")).toBe(true);
    expect(agentHasPricedModels("aider")).toBe(false);
  });
});
