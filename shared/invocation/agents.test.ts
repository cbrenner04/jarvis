import { describe, expect, test } from "bun:test";
import { createResolvedAgentBinding } from "./agents.ts";

describe("createResolvedAgentBinding", () => {
  test("binding id distinguishes rungs that differ only by price key", () => {
    const cheap = createResolvedAgentBinding({
      agentId: "claude",
      adapterModel: "sonnet",
      priceKey: "sonnet-input",
    });
    const premium = createResolvedAgentBinding({
      agentId: "claude",
      adapterModel: "sonnet",
      priceKey: "sonnet-output",
    });

    expect(cheap.id).toBe("claude/sonnet/sonnet-input");
    expect(premium.id).toBe("claude/sonnet/sonnet-output");
    expect(cheap.id).not.toBe(premium.id);
  });
});
