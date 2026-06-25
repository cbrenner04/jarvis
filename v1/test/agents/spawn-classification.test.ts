import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent } from "../../src/agents/spawn.ts";
import { createFakeSpawnWithOutput } from "./fake-spawn.ts";

describe("spawn classification order: transient → auth → model_config → quota", () => {
  test("durable auth stderr surfaces as quota with authFailure: true for Codex", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "spawn-test-"));
    const stderr =
      "Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.";
    const recorder = createFakeSpawnWithOutput({
      codex: { exit: 1, stdout: "", stderr },
    });

    const result = await runAgent(
      {
        name: "codex",
        binary: "codex",
        cwd,
        buildArgv: () => [],
        stdio: ["ignore", "pipe", "pipe"],
        streamErrorPrefix: "test:",
        spawn: recorder.spawn,
      },
      "test",
      { cwd },
    );

    expect(result).toEqual({ kind: "quota", stderr, authFailure: true });
  });

  test("bare 401/unauthorized does not trigger auth rotation for Codex", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "spawn-test-"));
    const stderr = "401 Unauthorized";
    const recorder = createFakeSpawnWithOutput({
      codex: { exit: 401, stdout: "", stderr },
    });

    const result = await runAgent(
      {
        name: "codex",
        binary: "codex",
        cwd,
        buildArgv: () => [],
        stdio: ["ignore", "pipe", "pipe"],
        streamErrorPrefix: "test:",
        spawn: recorder.spawn,
      },
      "test",
      { cwd },
    );

    expect(result).toEqual({ kind: "error", exitCode: 401, stderr });
  });

  test(
    "stderr matching both auth and transient retries same agent on error kind",
    async () => {
      const cwd = mkdtempSync(join(tmpdir(), "spawn-test-"));
      const stderr = "connection reset: refresh token revoked";
      const recorder = createFakeSpawnWithOutput({
        codex: { exit: 1, stdout: "", stderr },
      });

      const result = await runAgent(
        {
          name: "codex",
          binary: "codex",
          cwd,
          buildArgv: () => [],
          stdio: ["ignore", "pipe", "pipe"],
          streamErrorPrefix: "test:",
          spawn: recorder.spawn,
        },
        "test",
        { cwd },
      );

      // Transient wins in the precedence order, so this stays as error (no authFailure rotation)
      expect(result).toEqual({ kind: "error", exitCode: 1, stderr });
    },
    { timeout: 10000 },
  );

  test("genuine model-id misconfiguration stays model_config", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "spawn-test-"));
    const stderr = "unknown model: fake-model-xyz";
    const recorder = createFakeSpawnWithOutput({
      codex: { exit: 1, stdout: "", stderr },
    });

    const result = await runAgent(
      {
        name: "codex",
        binary: "codex",
        cwd,
        buildArgv: () => [],
        stdio: ["ignore", "pipe", "pipe"],
        streamErrorPrefix: "test:",
        spawn: recorder.spawn,
      },
      "test",
      { cwd },
    );

    expect(result).toEqual({ kind: "model_config", stderr });
  });

  test("regular quota signal stays quota without authFailure marker", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "spawn-test-"));
    const stderr = "You've reached your usage limit";
    const recorder = createFakeSpawnWithOutput({
      codex: { exit: 1, stdout: "", stderr },
    });

    const result = await runAgent(
      {
        name: "codex",
        binary: "codex",
        cwd,
        buildArgv: () => [],
        stdio: ["ignore", "pipe", "pipe"],
        streamErrorPrefix: "test:",
        spawn: recorder.spawn,
      },
      "test",
      { cwd },
    );

    expect(result).toEqual({ kind: "quota", stderr });
    if (result.kind === "quota") {
      expect(result.authFailure).toBeUndefined();
    }
  });

  test("auth failure on non-codex agents does not rotate", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "spawn-test-"));
    const stderr =
      "Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.";
    const recorder = createFakeSpawnWithOutput({
      claude: { exit: 1, stdout: "", stderr },
    });

    const result = await runAgent(
      {
        name: "claude",
        binary: "claude",
        cwd,
        buildArgv: () => [],
        stdio: ["ignore", "pipe", "pipe"],
        streamErrorPrefix: "test:",
        spawn: recorder.spawn,
      },
      "test",
      { cwd },
    );

    // Auth patterns are only defined for codex, so this falls through to error
    expect(result).toEqual({ kind: "error", exitCode: 1, stderr });
  });
});
