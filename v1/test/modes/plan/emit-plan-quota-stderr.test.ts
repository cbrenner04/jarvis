import { describe, expect, test } from "bun:test";
import { emitPlanAgentQuotaFallback } from "../../../src/modes/plan/emit-plan-quota-stderr.ts";
import {
  HARNESS_QUOTA_FALLBACK_STRICT,
  harnessAuthRotateLine,
  harnessQuotaFallbackLenientLine,
} from "../../../src/quota-harness-messages.ts";

describe("emitPlanAgentQuotaFallback", () => {
  test("strict quota rotation matches patch harness substring contract", () => {
    let out = "";
    emitPlanAgentQuotaFallback(
      (s: string) => {
        out += s;
      },
      "claude",
      { kind: "quota", stderr: "limit" },
      { kind: "quota", stderr: "limit" },
    );
    expect(out).toBe(`plan: claude: ${HARNESS_QUOTA_FALLBACK_STRICT}\n`);
  });

  test("lenient weak-quota rotation matches patch harness substring contract", () => {
    let out = "";
    emitPlanAgentQuotaFallback(
      (s: string) => {
        out += s;
      },
      "claude",
      { kind: "error", exitCode: 1, stderr: "HTTP 429" },
      { kind: "quota", stderr: "HTTP 429" },
    );
    expect(out).toBe(`plan: claude: ${harnessQuotaFallbackLenientLine(1)}\n`);
  });

  test("auth rotation emits auth re-authenticate note", () => {
    let out = "";
    emitPlanAgentQuotaFallback(
      (s: string) => {
        out += s;
      },
      "codex",
      { kind: "quota", stderr: "refresh token revoked", authFailure: true },
      { kind: "quota", stderr: "refresh token revoked", authFailure: true },
    );
    expect(out).toBe(`plan: codex: ${harnessAuthRotateLine("codex")}\n`);
  });

  test("plain quota rotation does not emit auth note", () => {
    let out = "";
    emitPlanAgentQuotaFallback(
      (s: string) => {
        out += s;
      },
      "claude",
      { kind: "quota", stderr: "limit exceeded" },
      { kind: "quota", stderr: "limit exceeded" },
    );
    expect(out).not.toContain("auth failed");
    expect(out).toContain(HARNESS_QUOTA_FALLBACK_STRICT);
  });
});
