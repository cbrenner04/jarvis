import { describe, expect, test } from "bun:test";
import {
  isModelConfigurationSignal,
  isQuotaSignal,
} from "../../src/agents/quota.ts";

describe("isQuotaSignal", () => {
  test("matches Claude Code subscription limits", () => {
    expect(
      isQuotaSignal(
        "claude",
        1,
        "You've hit your session limit · resets 3:45pm",
      ),
    ).toBe(true);
    expect(
      isQuotaSignal(
        "claude",
        1,
        "You've hit your weekly limit · resets Mon 12:00am",
      ),
    ).toBe(true);
    expect(
      isQuotaSignal("claude", 1, "You've hit your org's monthly usage limit"),
    ).toBe(true);
  });

  test("does not treat generic Claude Code errors as quota", () => {
    expect(
      isQuotaSignal("claude", 1, "Not logged in · Please run /login"),
    ).toBe(false);
    expect(
      isQuotaSignal(
        "claude",
        0,
        "You've hit your session limit · resets 3:45pm",
      ),
    ).toBe(false);
  });

  test("matches Codex usage-limit output", () => {
    expect(
      isQuotaSignal(
        "codex",
        1,
        "You've reached your usage limit. Try again later.",
      ),
    ).toBe(true);
    expect(isQuotaSignal("codex", 1, "error: rate_limit_exceeded")).toBe(true);
  });

  test("does not treat generic Codex errors as quota", () => {
    expect(
      isQuotaSignal("codex", 1, "stream disconnected before completion"),
    ).toBe(false);
    expect(
      isQuotaSignal("codex", 1, "Not authenticated. Please run codex login."),
    ).toBe(false);
  });

  test("matches Cursor usage-limit output", () => {
    expect(
      isQuotaSignal(
        "cursor",
        1,
        "Error: You've hit your usage limit\nchatMessage: *You've hit your free requests limit.*",
      ),
    ).toBe(true);
    expect(
      isQuotaSignal("cursor", 1, "ConnectError: [resource_exhausted] Error"),
    ).toBe(true);
  });

  test("does not treat generic Cursor errors as quota", () => {
    expect(
      isQuotaSignal(
        "cursor",
        1,
        "Connection failed. Check your internet connection.",
      ),
    ).toBe(false);
    expect(
      isQuotaSignal("cursor", 1, "No Cursor IDE installation found."),
    ).toBe(false);
  });

  test.each([
    "rate limit reached",
    "quota exceeded",
    "insufficient_quota",
    "error: HTTP 429 from provider",
    "you have exceeded your current quota",
  ])("matches Opencode quota output: %s", (stderr) => {
    expect(isQuotaSignal("opencode", 1, stderr)).toBe(true);
  });

  test("does not treat successful Opencode output as quota", () => {
    expect(isQuotaSignal("opencode", 0, "rate limit reached")).toBe(false);
  });

  test.each([
    "AirProxy: rate limit exceeded",
    "AirProxy policy denied the request",
    "upstream returned 403 Forbidden",
  ])("matches AirProxy quota output: %s", (stderr) => {
    expect(isQuotaSignal("airproxy", 1, stderr)).toBe(true);
  });

  test.each([
    "Copilot plan limit reached",
    "Copilot quota unavailable",
    "You have exceeded your monthly Copilot quota",
  ])("matches Copilot quota output: %s", (stderr) => {
    expect(isQuotaSignal("copilot", 1, stderr)).toBe(true);
  });

  test("does not add provider-specific quota output to generic Opencode", () => {
    expect(isQuotaSignal("opencode", 1, "AirProxy policy denied")).toBe(false);
    expect(isQuotaSignal("opencode", 1, "Copilot plan limit reached")).toBe(
      false,
    );
  });
});

describe("isModelConfigurationSignal", () => {
  test.each([
    "model not found",
    "unknown model",
    "unsupported model",
    "invalid model",
    "no provider configured for airproxy",
  ])("matches Opencode model configuration output: %s", (stderr) => {
    expect(isModelConfigurationSignal("opencode", stderr)).toBe(true);
  });

  test.each([
    ["airproxy", "unknown provider: airproxy"],
    ["copilot", "unknown provider: github-copilot"],
  ] as const)("matches %s model configuration output: %s", (name, stderr) => {
    expect(isModelConfigurationSignal(name, stderr)).toBe(true);
  });

  test("does not add provider-specific model configuration output to generic Opencode", () => {
    expect(
      isModelConfigurationSignal("opencode", "unknown provider: airproxy"),
    ).toBe(false);
    expect(
      isModelConfigurationSignal(
        "opencode",
        "unknown provider: github-copilot",
      ),
    ).toBe(false);
  });
});
