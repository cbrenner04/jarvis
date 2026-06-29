import { describe, expect, test } from "bun:test";
import type { AgentName } from "../../../src/config.ts";
import type { AgentResult } from "../../../src/agents/types.ts";
import { emitPlanAgentQuotaFallback } from "../../../src/modes/plan/emit-plan-quota-stderr.ts";
import {
  HARNESS_MODEL_CONFIG_FALLBACK,
  HARNESS_QUOTA_FALLBACK_STRICT,
  harnessAuthRotateLine,
  harnessQuotaFallbackLenientLine,
} from "../../../src/quota-harness-messages.ts";

function capture(
  agent: AgentName,
  spawnResult: AgentResult,
  classified: AgentResult,
  rotation?: Parameters<typeof emitPlanAgentQuotaFallback>[4],
): string {
  let out = "";
  emitPlanAgentQuotaFallback((s) => {
    out += s;
  }, agent, spawnResult, classified, rotation);
  return out;
}

describe("emitPlanAgentQuotaFallback", () => {
  test("strict quota rotation matches patch harness substring contract", () => {
    expect(capture("claude", { kind: "quota", stderr: "limit" }, { kind: "quota", stderr: "limit" })).toBe(
      `plan: claude: ${HARNESS_QUOTA_FALLBACK_STRICT}\n`,
    );
  });

  test("lenient weak-quota rotation matches patch harness substring contract", () => {
    expect(
      capture(
        "claude",
        { kind: "error", exitCode: 1, stderr: "HTTP 429" },
        { kind: "quota", stderr: "HTTP 429" },
      ),
    ).toBe(`plan: claude: ${harnessQuotaFallbackLenientLine(1)}\n`);
  });

  test("auth rotation emits auth re-authenticate note", () => {
    expect(
      capture(
        "codex",
        { kind: "quota", stderr: "refresh token revoked", authFailure: true },
        { kind: "quota", stderr: "refresh token revoked", authFailure: true },
      ),
    ).toBe(`plan: codex: ${harnessAuthRotateLine("codex")}\n`);
  });

  test("plain quota rotation does not emit auth note", () => {
    const out = capture("claude", { kind: "quota", stderr: "limit exceeded" }, { kind: "quota", stderr: "limit exceeded" });
    expect(out).not.toContain("auth failed");
    expect(out).toContain(HARNESS_QUOTA_FALLBACK_STRICT);
  });

  test("model_config rotation on draft uses plan prefix and harness fallback phrase", () => {
    expect(
      capture(
        "claude",
        { kind: "model_config", stderr: "unknown model" },
        { kind: "model_config", stderr: "unknown model" },
        "draft",
      ),
    ).toBe(`plan: claude: ${HARNESS_MODEL_CONFIG_FALLBACK}\nunknown model\n`);
  });

  test("model_config rotation on intent uses intent prefix", () => {
    expect(
      capture("codex", { kind: "model_config", stderr: "" }, { kind: "model_config", stderr: "" }, "intent"),
    ).toBe(`intent: codex: ${HARNESS_MODEL_CONFIG_FALLBACK}\n`);
  });

  test("model_config rotation is suppressed on quota-only rotation", () => {
    expect(
      capture("claude", { kind: "model_config", stderr: "unknown model" }, { kind: "model_config", stderr: "unknown model" }),
    ).toBe("");
  });
});
