import { describe, expect, test } from "bun:test";
import { isClaudeQuotaMessageText, isQuotaSignal } from "../src/agents/quota.ts";

describe("quota patterns with U+2019", () => {
  describe("claude quota patterns", () => {
    test("classifies session limit with U+2019 as quota", () => {
      expect(isClaudeQuotaMessageText("you’ve hit your session limit")).toBe(true);
    });

    test("classifies weekly limit with U+2019 as quota", () => {
      expect(isClaudeQuotaMessageText("you’ve hit your weekly limit")).toBe(true);
    });

    test("classifies opus limit with U+2019 as quota", () => {
      expect(isClaudeQuotaMessageText("you’ve hit your opus limit")).toBe(true);
    });

    test("classifies monthly spend limit with U+2019 as quota", () => {
      expect(isClaudeQuotaMessageText("you’ve hit your monthly spend limit")).toBe(true);
    });

    test("classifies org's monthly usage limit with U+2019 as quota", () => {
      expect(isClaudeQuotaMessageText("you’ve hit your org’s monthly usage limit")).toBe(true);
    });

    test("isQuotaSignal detects session limit with U+2019", () => {
      expect(isQuotaSignal("claude", 1, "you’ve hit your session limit")).toBe(true);
    });

    test("isQuotaSignal detects monthly spend limit with U+2019", () => {
      expect(isQuotaSignal("claude", 1, "you’ve hit your monthly spend limit")).toBe(true);
    });

    test("isQuotaSignal detects org's monthly usage limit with U+2019", () => {
      expect(isQuotaSignal("claude", 1, "you’ve hit your org’s monthly usage limit")).toBe(true);
    });
  });

  describe("codex quota patterns", () => {
    test("isQuotaSignal detects 'hit your usage limit' with U+2019", () => {
      expect(isQuotaSignal("codex", 1, "you’ve hit your usage limit")).toBe(true);
    });

    test("isQuotaSignal detects 'reached your usage limit' with U+2019", () => {
      expect(isQuotaSignal("codex", 1, "you’ve reached your usage limit")).toBe(true);
    });
  });

  describe("cursor quota patterns", () => {
    test("isQuotaSignal detects 'hit your usage limit' with U+2019", () => {
      expect(isQuotaSignal("cursor", 1, "you’ve hit your usage limit")).toBe(true);
    });

    test("isQuotaSignal detects 'hit your free requests limit' with U+2019", () => {
      expect(isQuotaSignal("cursor", 1, "you’ve hit your free requests limit")).toBe(true);
    });
  });
});
