import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentName, AgentResult } from "../../src/agents/types.ts";
import { runAgent } from "../../src/agents/spawn.ts";
import { createFakeSpawnWithOutput } from "./fake-spawn.ts";

const CODEX_REFRESH_TOKEN_REVOKED =
  "Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.";

async function classifyAgentError(
  agentName: AgentName,
  exitCode: number,
  stderr: string,
): Promise<AgentResult> {
  const cwd = mkdtempSync(join(tmpdir(), "spawn-test-"));
  const recorder = createFakeSpawnWithOutput({
    [agentName]: { exit: exitCode, stdout: "", stderr },
  });

  return await runAgent(
    {
      name: agentName,
      binary: agentName,
      cwd,
      buildArgv: () => [],
      stdio: ["ignore", "pipe", "pipe"],
      streamErrorPrefix: "test:",
      spawn: recorder.spawn,
    },
    "test",
    { cwd },
  );
}

describe("spawn classification order: transient → auth → model_config → quota", () => {
  test("durable auth stderr surfaces as quota with authFailure: true for Codex", async () => {
    const result = await classifyAgentError("codex", 1, CODEX_REFRESH_TOKEN_REVOKED);
    expect(result).toEqual({ kind: "quota", stderr: CODEX_REFRESH_TOKEN_REVOKED, authFailure: true });
  });

  test("bare 401/unauthorized does not trigger auth rotation for Codex", async () => {
    const result = await classifyAgentError("codex", 401, "401 Unauthorized");
    expect(result).toEqual({ kind: "error", exitCode: 401, stderr: "401 Unauthorized" });
  });

  test("stderr matching both auth and transient retries same agent on error kind", async () => {
    const stderr = "connection reset: refresh token revoked";
    const result = await classifyAgentError("codex", 1, stderr);
    // Transient wins in the precedence order, so this stays as error (no authFailure rotation)
    expect(result).toEqual({ kind: "error", exitCode: 1, stderr });
  });

  test("genuine model-id misconfiguration stays model_config", async () => {
    const result = await classifyAgentError("codex", 1, "unknown model: fake-model-xyz");
    expect(result).toEqual({ kind: "model_config", stderr: "unknown model: fake-model-xyz" });
  });

  test("regular quota signal stays quota without authFailure marker", async () => {
    const stderr = "You've reached your usage limit";
    const result = await classifyAgentError("codex", 1, stderr);
    expect(result).toEqual({ kind: "quota", stderr });
    if (result.kind === "quota") {
      expect(result.authFailure).toBeUndefined();
    }
  });

  test("auth failure on non-codex agents does not rotate", async () => {
    const result = await classifyAgentError("claude", 1, CODEX_REFRESH_TOKEN_REVOKED);
    // Auth patterns are only defined for codex, so this falls through to error
    expect(result).toEqual({ kind: "error", exitCode: 1, stderr: CODEX_REFRESH_TOKEN_REVOKED });
  });
});
