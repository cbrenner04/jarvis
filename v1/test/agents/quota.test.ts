import { describe, expect, test } from "bun:test";
import {
  applyQuotaFallbackToAgentResult,
  applyQuotaFallbackWhenAllowed,
  isCredentialAuthSignal,
  isModelConfigurationSignal,
  isQuotaSignal,
  isTransientNetworkError,
  isTransientSignal,
  isWeakQuotaSignal,
} from "../../src/agents/quota.ts";

describe("isQuotaSignal", () => {
  test("matches Claude Code subscription limits", () => {
    expect(isQuotaSignal("claude", 1, "You've hit your session limit · resets 3:45pm")).toBe(true);
    expect(isQuotaSignal("claude", 1, "You've hit your weekly limit · resets Mon 12:00am")).toBe(true);
    expect(isQuotaSignal("claude", 1, "You've hit your org's monthly usage limit")).toBe(true);
    expect(isQuotaSignal("claude", 1, "You've hit your monthly spend limit")).toBe(true);
  });

  test("matches Claude insufficient_quota / exhausted wording", () => {
    expect(isQuotaSignal("claude", 1, "error: insufficient_quota")).toBe(true);
    expect(isQuotaSignal("claude", 1, "quota exceeded for this key")).toBe(true);
    expect(isQuotaSignal("claude", 1, "requests have been exhausted for today")).toBe(true);
  });

  test("does not treat generic Claude Code errors as quota", () => {
    expect(isQuotaSignal("claude", 1, "Not logged in · Please run /login")).toBe(false);
    expect(isQuotaSignal("claude", 0, "You've hit your session limit · resets 3:45pm")).toBe(false);
  });

  test("matches Codex usage-limit output", () => {
    expect(isQuotaSignal("codex", 1, "You've reached your usage limit. Try again later.")).toBe(true);
    expect(isQuotaSignal("codex", 1, "error: rate_limit_exceeded")).toBe(true);
  });

  test("matches Codex insufficient_quota wording", () => {
    expect(isQuotaSignal("codex", 1, '{"error":"insufficient_quota"}')).toBe(true);
  });

  test("does not treat generic Codex errors as quota", () => {
    expect(isQuotaSignal("codex", 1, "stream disconnected before completion")).toBe(false);
    expect(isQuotaSignal("codex", 1, "Not authenticated. Please run codex login.")).toBe(false);
  });

  test("matches Cursor usage-limit output", () => {
    expect(
      isQuotaSignal(
        "cursor",
        1,
        "Error: You've hit your usage limit\nchatMessage: *You've hit your free requests limit.*",
      ),
    ).toBe(true);
    expect(isQuotaSignal("cursor", 1, "ConnectError: [resource_exhausted] Error")).toBe(true);
  });

  test("does not treat generic Cursor errors as quota", () => {
    expect(isQuotaSignal("cursor", 1, "Connection failed. Check your internet connection.")).toBe(false);
    expect(isQuotaSignal("cursor", 1, "No Cursor IDE installation found.")).toBe(false);
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
    "rate limit reached",
    "quota exceeded",
    "insufficient_quota",
    "error: HTTP 429 from provider",
  ])("matches Aider quota output: %s", (stderr) => {
    expect(isQuotaSignal("aider", 1, stderr)).toBe(true);
  });

  test("does not treat successful Aider output as quota", () => {
    expect(isQuotaSignal("aider", 0, "rate limit reached")).toBe(false);
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
    "model not found",
    "unknown model",
    "unsupported model",
    "invalid model",
    "could not connect to ollama",
    "connection refused at localhost",
    "model is not loaded",
    "no such model",
  ])("matches Aider model configuration output: %s", (stderr) => {
    expect(isModelConfigurationSignal("aider", stderr)).toBe(true);
  });

  test("does not match bare 'connection refused' for Aider without model/host hint", () => {
    expect(isModelConfigurationSignal("aider", "connection refused")).toBe(false);
  });
});

describe("isCredentialAuthSignal", () => {
  const CODEX_REFRESH_TOKEN_REVOKED =
    "Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.";

  test("matches Codex refresh token revoked sample", () => {
    expect(isCredentialAuthSignal("codex", 1, CODEX_REFRESH_TOKEN_REVOKED)).toBe(true);
  });

  test("matches Codex re-authenticate patterns", () => {
    expect(isCredentialAuthSignal("codex", 1, "Please re-authenticate to continue")).toBe(true);
    expect(isCredentialAuthSignal("codex", 1, "Re-authentication required")).toBe(true);
    expect(isCredentialAuthSignal("codex", 1, "refresh token revoked")).toBe(true);
    expect(isCredentialAuthSignal("codex", 1, "Please log out and sign in again")).toBe(true);
  });

  test("does not match bare 401 or unauthorized", () => {
    expect(isCredentialAuthSignal("codex", 401, "401 Unauthorized")).toBe(false);
    expect(isCredentialAuthSignal("codex", 1, "401 unauthorized")).toBe(false);
  });

  test("does not treat model configuration as auth failure", () => {
    expect(isCredentialAuthSignal("codex", 1, "unknown model")).toBe(false);
  });

  test("does not classify auth signals for non-codex agents", () => {
    expect(
      isCredentialAuthSignal(
        "claude",
        1,
        "Your access token could not be refreshed because your refresh token was revoked.",
      ),
    ).toBe(false);
    expect(
      isCredentialAuthSignal(
        "cursor",
        1,
        "Your access token could not be refreshed because your refresh token was revoked.",
      ),
    ).toBe(false);
  });

  test("matches regardless of exit code value", () => {
    expect(
      isCredentialAuthSignal(
        "codex",
        0,
        "Your access token could not be refreshed because your refresh token was revoked.",
      ),
    ).toBe(true);
  });
});

describe("isWeakQuotaSignal", () => {
  test("matches weak quota-like transport text", () => {
    expect(isWeakQuotaSignal("claude", 1, "HTTP 429: too many requests")).toBe(true);
    expect(isWeakQuotaSignal("codex", 1, "service unavailable (503)")).toBe(true);
    expect(isWeakQuotaSignal("cursor", 1, "rate-limit applied")).toBe(true);
  });

  test("does not classify success or unrelated errors as weak quota", () => {
    expect(isWeakQuotaSignal("claude", 0, "HTTP 429: too many requests")).toBe(false);
    expect(isWeakQuotaSignal("claude", 1, "TypeScript compile error in src/run.ts")).toBe(false);
  });

  test("matches when exit code is in the configured weakExitCodes list", () => {
    expect(isWeakQuotaSignal("claude", 7, "TypeScript compile error", [7])).toBe(true);
    expect(isWeakQuotaSignal("claude", 7, "TypeScript compile error", new Set([7]))).toBe(true);
  });

  test("does not match when exit code is outside the configured list", () => {
    expect(isWeakQuotaSignal("claude", 2, "TypeScript compile error", [7])).toBe(false);
  });
});

describe("applyQuotaFallbackToAgentResult", () => {
  const lenientOpts = {
    quotaFallback: "lenient" as const,
    weakQuotaExitCodes: [] as readonly number[],
  };
  const strictOpts = {
    quotaFallback: "strict" as const,
    weakQuotaExitCodes: [] as readonly number[],
  };

  test("passes through non-error results unchanged", () => {
    const ok = { kind: "ok" as const, stdout: "", stderr: "" };
    expect(applyQuotaFallbackToAgentResult("claude", ok, lenientOpts)).toBe(ok);

    const quota = { kind: "quota" as const, stderr: "limit" };
    expect(applyQuotaFallbackToAgentResult("claude", quota, lenientOpts)).toEqual(quota);
  });

  test("lenient mode upgrades weak-quota-like errors to quota", () => {
    const err = {
      kind: "error" as const,
      exitCode: 1,
      stderr: "HTTP 429: too many requests",
    };
    expect(applyQuotaFallbackToAgentResult("claude", err, lenientOpts)).toEqual({
      kind: "quota",
      stderr: err.stderr,
    });
  });

  test("strict mode leaves weak-quota-like errors as errors", () => {
    const err = {
      kind: "error" as const,
      exitCode: 1,
      stderr: "HTTP 429: too many requests",
    };
    expect(applyQuotaFallbackToAgentResult("claude", err, strictOpts)).toBe(err);
  });
});

describe("applyQuotaFallbackWhenAllowed", () => {
  const lenientOpts = {
    quotaFallback: "lenient" as const,
    weakQuotaExitCodes: [] as readonly number[],
  };

  test("skips weak upgrade when caller disallow flag is false", () => {
    const err = {
      kind: "error" as const,
      exitCode: 1,
      stderr: "HTTP 429: too many requests",
    };
    expect(applyQuotaFallbackWhenAllowed("claude", err, lenientOpts, false)).toBe(err);
  });

  test("delegates to applyQuotaFallbackToAgentResult when allowed", () => {
    const err = {
      kind: "error" as const,
      exitCode: 1,
      stderr: "HTTP 429: too many requests",
    };
    expect(applyQuotaFallbackWhenAllowed("claude", err, lenientOpts, true)).toEqual({
      kind: "quota",
      stderr: err.stderr,
    });
  });
});

describe("isTransientSignal", () => {
  const expectTransient = (name: Parameters<typeof isTransientSignal>[0], stderr: string, expected = true) => {
    expect(isTransientSignal(name, 1, stderr)).toBe(expected);
  };

  test("matches transport connection patterns", () => {
    expectTransient("claude", "connection closed");
    expectTransient("claude", "connection reset by peer");
    expectTransient("claude", "socket hang up");
    expectTransient("claude", "broken pipe");
    expectTransient("claude", "ECONNRESET");
    expectTransient("claude", "EPIPE");
  });

  test("matches stream error patterns", () => {
    expect(isTransientSignal("claude", 1, "premature close")).toBe(true);
    expect(isTransientSignal("claude", 1, "stream closed prematurely")).toBe(true);
    expect(isTransientSignal("claude", 1, "stream closed")).toBe(true);
  });

  test("matches HTTP error status codes with context", () => {
    expect(isTransientSignal("claude", 1, "error: HTTP 502 Bad Gateway")).toBe(true);
    expect(isTransientSignal("claude", 1, "error: HTTP 503 Service Unavailable")).toBe(true);
    expect(isTransientSignal("claude", 1, "error: HTTP 504 Gateway Timeout")).toBe(true);
    expect(isTransientSignal("claude", 1, "HTTP status 502")).toBe(true);
    expect(isTransientSignal("claude", 1, "service unavailable")).toBe(true);
    expect(isTransientSignal("claude", 1, "server overloaded")).toBe(true);
  });

  test("matches opencode UnknownError/500 and guarded HTTP 500", () => {
    expectTransient("opencode", "opencode: UnknownError: HTTP 500 Internal Server Error");
    expectTransient("opencode", "opencode: HTTP 500 Internal Server Error");
    expectTransient("opencode", "opencode: provider failure status 500 from upstream");
  });

  test("scopes UnknownError and HTTP 500 matching to opencode only", () => {
    expectTransient("opencode", "UnknownError: provider request failed", false);
    expectTransient("claude", "UnknownError: HTTP 500 Internal Server Error", false);
    expectTransient("claude", "HTTP 500 Internal Server Error", false);
    expectTransient("codex", "status 500 failure", false);
  });

  test("still matches shared transport patterns for opencode", () => {
    expectTransient("opencode", "error: HTTP 503 Service Unavailable");
    expectTransient("opencode", "connection reset by peer");
  });

  test("does not match bare status codes without context", () => {
    expectTransient("claude", "returned value 502", false);
    expectTransient("claude", "The answer is 503", false);
    expectTransient("claude", "some process exited 529", false);
    expectTransient("opencode", "returned value 500", false);
  });

  test("does not match on exit code 0", () => {
    expect(isTransientSignal("claude", 0, "connection closed")).toBe(false);
    expect(isTransientSignal("claude", 0, "error: HTTP 503")).toBe(false);
  });

  test("does not classify quota signals as transient", () => {
    expect(isTransientSignal("claude", 1, "You've hit your session limit")).toBe(false);
    expect(isTransientSignal("claude", 1, "quota exceeded")).toBe(false);
  });

  test("does not classify model configuration signals as transient", () => {
    expect(isTransientSignal("claude", 1, "unknown model")).toBe(false);
    expect(isTransientSignal("claude", 1, "model not found")).toBe(false);
  });
});

describe("isTransientNetworkError", () => {
  test("matches shared transport patterns", () => {
    expect(isTransientNetworkError(1, "connection closed")).toBe(true);
    expect(isTransientNetworkError(1, "connection reset by peer")).toBe(true);
    expect(isTransientNetworkError(1, "socket hang up")).toBe(true);
    expect(isTransientNetworkError(1, "broken pipe")).toBe(true);
    expect(isTransientNetworkError(1, "error: HTTP 502 Bad Gateway")).toBe(true);
    expect(isTransientNetworkError(1, "error: HTTP 503 Service Unavailable")).toBe(true);
  });

  test("matches git/gh-specific TLS patterns", () => {
    expect(isTransientNetworkError(1, "TLS handshake timeout")).toBe(true);
    expect(isTransientNetworkError(1, "SSL_ERROR")).toBe(true);
    expect(isTransientNetworkError(1, "SSL error: something went wrong")).toBe(true);
    expect(isTransientNetworkError(1, "handshake failure")).toBe(true);
  });

  test("matches git/gh-specific DNS patterns", () => {
    expect(isTransientNetworkError(1, "could not resolve host")).toBe(true);
    expect(isTransientNetworkError(1, "could not resolve host github.com")).toBe(true);
  });

  test("matches git/gh-specific timeout patterns", () => {
    expect(isTransientNetworkError(1, "operation timed out")).toBe(true);
    expect(isTransientNetworkError(1, "timed out waiting for response")).toBe(true);
  });

  test("matches git/gh remote hang-up pattern", () => {
    expect(isTransientNetworkError(1, "the remote end hung up unexpectedly")).toBe(true);
  });

  test("does not match on exit code 0", () => {
    expect(isTransientNetworkError(0, "TLS handshake timeout")).toBe(false);
    expect(isTransientNetworkError(0, "could not resolve host")).toBe(false);
    expect(isTransientNetworkError(0, "connection closed")).toBe(false);
  });

  test("does not match permanent gh failures", () => {
    expect(isTransientNetworkError(1, "BLOCKED")).toBe(false);
    expect(isTransientNetworkError(1, "not authenticated")).toBe(false);
    expect(isTransientNetworkError(1, "404")).toBe(false);
  });

  test("agent classifier stays unchanged (isTransientSignal truth table)", () => {
    // Verify that isTransientSignal still works as before
    expect(isTransientSignal("claude", 1, "connection closed")).toBe(true);
    expect(isTransientSignal("claude", 0, "connection closed")).toBe(false);
    expect(isTransientSignal("claude", 1, "unknown model")).toBe(false);
  });
});
