import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeAgent, resolveClaudePriceKey } from "../../src/agents/claude.ts";
import { createFakeSpawnWithOutput } from "./fake-spawn.ts";

const fixturesDir = join(import.meta.dir, "..", "fixtures", "claude");

function claudeJson(result: string): string {
  return JSON.stringify({ type: "result", result });
}

describe("ClaudeAgent", () => {
  test("name is 'claude'", () => {
    expect(new ClaudeAgent().name).toBe("claude");
  });

  test("spawns `claude -p` with prompt on stdin in cwd, mapping exit 0 → ok", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "claude-cwd-"));
    const recorder = createFakeSpawnWithOutput({
      claude: {
        exit: 0,
        stdout: claudeJson("hi-out"),
        stderr: "hi-err",
      },
    });
    const agent = new ClaudeAgent({ spawn: recorder.spawn });

    const result = await agent.run("the prompt", { cwd });

    expect(result).toEqual({ kind: "ok", stdout: "hi-out", stderr: "hi-err" });
    expect(recorder.records).toHaveLength(1);
    const record = recorder.only();
    expect(record.binary).toBe("claude");
    expect(record.argv).toEqual([
      "-p",
      "--permission-mode",
      "acceptEdits",
      "--output-format",
      "stream-json",
      "--verbose",
    ]);
    expect(record.opts.cwd).toBe(cwd);
  });

  test("includes model flag when model is configured", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "claude-cwd-"));
    const recorder = createFakeSpawnWithOutput({
      claude: { exit: 0, stdout: claudeJson("ok"), stderr: "" },
    });
    const agent = new ClaudeAgent({
      spawn: recorder.spawn,
      model: "haiku",
    });

    await agent.run("the prompt", { cwd });

    expect(recorder.records).toHaveLength(1);
    const record = recorder.only();
    expect(record.argv).toEqual([
      "-p",
      "--permission-mode",
      "acceptEdits",
      "--model",
      "haiku",
      "--output-format",
      "stream-json",
      "--verbose",
    ]);
  });

  test("non-zero exit maps to error with captured stderr", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "claude-cwd-"));
    const recorder = createFakeSpawnWithOutput({
      claude: { exit: 2, stdout: "", stderr: "boom" },
    });
    const agent = new ClaudeAgent({ spawn: recorder.spawn });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "error", exitCode: 2, stderr: "boom" });
  });

  test("non-zero exit includes captured stdout diagnostics", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "claude-cwd-"));
    const recorder = createFakeSpawnWithOutput({
      claude: { exit: 1, stdout: "Not logged in", stderr: "" },
    });
    const agent = new ClaudeAgent({ spawn: recorder.spawn });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({
      kind: "error",
      exitCode: 1,
      stderr: "Not logged in",
    });
  });

  test("quota signal maps to quota", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "claude-cwd-"));
    const stderr = "You've hit your session limit · resets 3:45pm";
    const recorder = createFakeSpawnWithOutput({
      claude: { exit: 1, stdout: "", stderr },
    });
    const agent = new ClaudeAgent({ spawn: recorder.spawn });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "quota", stderr });
  });

  test("unsupported model signal maps to model_config", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "claude-cwd-"));
    const stderr = "error: unknown model: haiku";
    const recorder = createFakeSpawnWithOutput({
      claude: { exit: 1, stdout: "", stderr },
    });
    const agent = new ClaudeAgent({ spawn: recorder.spawn, model: "haiku" });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "model_config", stderr });
  });

  test("quota signal can be read from stdout", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "claude-cwd-"));
    const stdout = "You've hit your session limit · resets 3:45pm";
    const recorder = createFakeSpawnWithOutput({
      claude: { exit: 1, stdout, stderr: "" },
    });
    const agent = new ClaudeAgent({ spawn: recorder.spawn });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "quota", stderr: stdout });
  });

  test("zero-exit monthly-spend-limit JSON envelope maps to quota with full stdout diagnostics", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "claude-cwd-"));
    const stdout = readFileSync(join(fixturesDir, "2.1.142-monthly-spend-limit.json"), "utf8");
    const recorder = createFakeSpawnWithOutput({
      claude: { exit: 0, stdout, stderr: "" },
    });
    const agent = new ClaudeAgent({ spawn: recorder.spawn });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "quota", stderr: stdout });
  });

  test("zero-exit structured errors without quota predicates remain ok", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "claude-cwd-"));
    const stdout = JSON.stringify({
      type: "result",
      is_error: true,
      api_error_status: 500,
      result: "Internal server error",
    });
    const recorder = createFakeSpawnWithOutput({
      claude: { exit: 0, stdout, stderr: "" },
    });
    const agent = new ClaudeAgent({ spawn: recorder.spawn });

    const result = await agent.run("p", { cwd });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.stdout).toBe("Internal server error");
    }
  });

  test("appends --add-dir for each additionalReadDirs entry", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "claude-cwd-"));
    const recorder = createFakeSpawnWithOutput({
      claude: { exit: 0, stdout: claudeJson("ok"), stderr: "" },
    });
    const agent = new ClaudeAgent({ spawn: recorder.spawn });

    await agent.run("p", {
      cwd,
      additionalReadDirs: ["/abs/specs/foo", "/abs/specs/bar"],
    });

    expect(recorder.records).toHaveLength(1);
    const record = recorder.only();
    expect(record.argv).toEqual([
      "-p",
      "--permission-mode",
      "acceptEdits",
      "--add-dir",
      "/abs/specs/foo",
      "--add-dir",
      "/abs/specs/bar",
      "--output-format",
      "stream-json",
      "--verbose",
    ]);
  });

  test("omits --add-dir when additionalReadDirs is unset", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "claude-cwd-"));
    const recorder = createFakeSpawnWithOutput({
      claude: { exit: 0, stdout: claudeJson("ok"), stderr: "" },
    });
    const agent = new ClaudeAgent({ spawn: recorder.spawn });

    await agent.run("p", { cwd });

    expect(recorder.records).toHaveLength(1);
    const record = recorder.only();
    expect(record.argv).not.toContain("--add-dir");
  });

  test("includes --permission-mode acceptEdits flag", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "claude-cwd-"));
    const recorder = createFakeSpawnWithOutput({
      claude: { exit: 0, stdout: claudeJson("ok"), stderr: "" },
    });
    const agent = new ClaudeAgent({ spawn: recorder.spawn });

    await agent.run("p", { cwd });

    expect(recorder.records).toHaveLength(1);
    const record = recorder.only();
    expect(record.argv).toContain("--permission-mode");
    expect(record.argv).toContain("acceptEdits");
  });

  test("attributionLabel returns mapped label for known model ID", () => {
    const agent = new ClaudeAgent({
      binary: "fake",
      model: "claude-opus-4-8",
    });
    expect(agent.attributionLabel()).toBe("Claude Opus 4.8");
  });

  test("attributionLabel returns raw string for unknown model ID", () => {
    const agent = new ClaudeAgent({
      binary: "fake",
      model: "claude-unknown-999",
    });
    expect(agent.attributionLabel()).toBe("claude-unknown-999");
  });

  test("attributionLabel returns default fallback when model is undefined", () => {
    const agent = new ClaudeAgent({ binary: "fake" });
    expect(agent.attributionLabel()).toBe("claude (default model)");
  });

  test("attributionLabel returns mapped label for claude-sonnet-5", () => {
    const agent = new ClaudeAgent({
      binary: "fake",
      model: "claude-sonnet-5",
    });
    expect(agent.attributionLabel()).toBe("Claude Sonnet 5");
  });

  test("resolveClaudePriceKey resolves a price key for claude-sonnet-5", () => {
    expect(resolveClaudePriceKey("claude-sonnet-5")).not.toBeNull();
  });

  test("resolveClaudePriceKey returns null for unmapped alias sonnet-5", () => {
    expect(resolveClaudePriceKey("sonnet-5")).toBeNull();
  });
});
