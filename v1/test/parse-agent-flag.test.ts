import { describe, expect, test } from "bun:test";
import type { AgentEntry } from "../src/config.ts";
import { parseAgentFlagValues, prefixAgentFlagError } from "../src/parse-agent-flag.ts";

const FALLBACK: AgentEntry[] = [
  { agent: "claude", model: "haiku" },
  { agent: "codex", model: "gpt-5.4" },
  { agent: "cursor", model: "Composer 2.5" },
];

describe("parseAgentFlagValues", () => {
  test("builds ladder in flag order with explicit models", () => {
    const result = parseAgentFlagValues(["codex:gpt-5.4", "claude:sonnet"], FALLBACK);
    expect(result).toEqual({
      ok: true,
      agentOrder: [
        { agent: "codex", model: "gpt-5.4" },
        { agent: "claude", model: "sonnet" },
      ],
    });
  });

  test("inherits model from fallback when :model omitted", () => {
    const result = parseAgentFlagValues(["codex", "claude"], FALLBACK);
    expect(result).toEqual({
      ok: true,
      agentOrder: [
        { agent: "codex", model: "gpt-5.4" },
        { agent: "claude", model: "haiku" },
      ],
    });
  });

  test("requires :model when fallback has no matching agent", () => {
    const result = parseAgentFlagValues(["opencode"], FALLBACK);
    expect(result).toEqual({
      ok: false,
      message: '--agent "opencode" requires :model',
    });
  });

  test("rejects unknown agent naming the flag value", () => {
    const result = parseAgentFlagValues(["bogus"], FALLBACK);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('"bogus"');
      expect(result.message).toContain("unknown agent");
    }
  });

  test("rejects empty model naming the flag value", () => {
    const result = parseAgentFlagValues(["claude:"], FALLBACK);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("non-empty string");
    }
  });

  test("rejects unknown priced model", () => {
    const result = parseAgentFlagValues(["codex:not-a-model"], FALLBACK);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("not a known priced model");
      expect(result.message).toContain("not-a-model");
    }
  });

  test("rejects duplicate agent", () => {
    const result = parseAgentFlagValues(["claude:haiku", "claude:sonnet"], FALLBACK);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('duplicate agent "claude"');
    }
  });

  test("splits on first colon only", () => {
    const result = parseAgentFlagValues(["opencode:provider:model"], FALLBACK);
    expect(result).toEqual({
      ok: true,
      agentOrder: [{ agent: "opencode", model: "provider:model" }],
    });
  });

  test("rejects empty agent name", () => {
    const result = parseAgentFlagValues([":model"], FALLBACK);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('":model"');
    }
  });
});

describe("prefixAgentFlagError", () => {
  test("prefixes run errors", () => {
    const result = parseAgentFlagValues(["bogus"], FALLBACK);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(prefixAgentFlagError("run", result.message)).toMatch(/^run: /);
    }
  });

  test("prefixes plan errors", () => {
    const result = parseAgentFlagValues(["bogus"], FALLBACK);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(prefixAgentFlagError("plan", result.message)).toMatch(/^plan: /);
    }
  });

  test("prefixes intent errors", () => {
    const result = parseAgentFlagValues(["bogus"], FALLBACK);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(prefixAgentFlagError("intent", result.message)).toMatch(/^intent: /);
    }
  });
});
