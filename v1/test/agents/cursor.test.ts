import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CursorAgent } from "../../src/agents/cursor.ts";
import { createFakeSpawnWithOutput } from "./fake-spawn.ts";

describe("CursorAgent", () => {
  test("name is 'cursor'", () => {
    expect(new CursorAgent().name).toBe("cursor");
  });

  test("spawns `cursor agent -p --output-format text --workspace <cwd> <prompt>` in cwd, mapping exit 0 → ok", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cursor-cwd-"));
    const recorder = createFakeSpawnWithOutput({
      cursor: { exit: 0, stdout: "hi-out", stderr: "hi-err" },
    });
    const agent = new CursorAgent({ spawn: recorder.spawn });

    const result = await agent.run("the prompt", { cwd });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.stdout).toBe("hi-out");
      expect(result.stderr).toBe("hi-err");
      expect(result.usage_source).toBe("estimated");
      expect(result.usage?.input_tokens).toBeGreaterThan(0);
      expect(result.usage?.output_tokens).toBeGreaterThan(0);
    }
    expect(recorder.records).toHaveLength(1);
    const record = recorder.only();
    expect(record.binary).toBe("cursor");
    expect(record.argv).toContain("agent");
    expect(record.argv).toContain("-p");
    expect(record.argv).toContain("--output-format");
    expect(record.argv).toContain("text");
    expect(record.argv).toContain("--force");
    expect(record.argv).toContain("--workspace");
    expect(record.argv).toContain(cwd);
    expect(record.argv).toContain("the prompt");
  });

  test("includes model flag when model is configured", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cursor-cwd-"));
    const recorder = createFakeSpawnWithOutput({
      cursor: { exit: 0, stdout: "ok", stderr: "" },
    });
    const agent = new CursorAgent({ spawn: recorder.spawn, model: "Composer 2.5" });

    await agent.run("the prompt", { cwd });

    expect(recorder.records).toHaveLength(1);
    const record = recorder.only();
    expect(record.argv).toContain("--model");
    expect(record.argv).toContain("composer-2.5");
  });

  test("maps Composer 2.5 Fast to the fast CLI slug", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cursor-cwd-"));
    const recorder = createFakeSpawnWithOutput({
      cursor: { exit: 0, stdout: "ok", stderr: "" },
    });
    const agent = new CursorAgent({ spawn: recorder.spawn, model: "Composer 2.5 Fast" });

    await agent.run("the prompt", { cwd });

    expect(recorder.records).toHaveLength(1);
    const record = recorder.only();
    expect(record.argv).toContain("--model");
    expect(record.argv).toContain("composer-2.5-fast");
  });

  test("non-zero exit maps to error with captured stderr", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cursor-cwd-"));
    const recorder = createFakeSpawnWithOutput({
      cursor: { exit: 2, stdout: "", stderr: "boom" },
    });
    const agent = new CursorAgent({ spawn: recorder.spawn });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "error", exitCode: 2, stderr: "boom" });
  });

  test("non-zero exit includes captured stdout diagnostics", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cursor-cwd-"));
    const recorder = createFakeSpawnWithOutput({
      cursor: { exit: 1, stdout: "No Cursor IDE installation", stderr: "" },
    });
    const agent = new CursorAgent({ spawn: recorder.spawn });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({
      kind: "error",
      exitCode: 1,
      stderr: "No Cursor IDE installation",
    });
  });

  test("quota signal maps to quota", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cursor-cwd-"));
    const stderr = "Error: You've hit your usage limit";
    const recorder = createFakeSpawnWithOutput({
      cursor: { exit: 1, stdout: "", stderr },
    });
    const agent = new CursorAgent({ spawn: recorder.spawn });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "quota", stderr });
  });

  test("unsupported model signal maps to model_config", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cursor-cwd-"));
    const stdout = "error: not available for your account";
    const recorder = createFakeSpawnWithOutput({
      cursor: { exit: 1, stdout, stderr: "" },
    });
    const agent = new CursorAgent({ spawn: recorder.spawn, model: "Composer 2" });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "model_config", stderr: stdout });
  });

  test("quota signal can be read from stdout", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cursor-cwd-"));
    const stdout = "Error: You've hit your usage limit";
    const recorder = createFakeSpawnWithOutput({
      cursor: { exit: 1, stdout, stderr: "" },
    });
    const agent = new CursorAgent({ spawn: recorder.spawn });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "quota", stderr: stdout });
  });

  test.skip("missing binary surfaces as error result, not a thrown exception", async () => {
    // This test requires real spawn behavior to detect ENOENT; the fake spawn cannot simulate this.
    // Agents handle missing binaries through spawn error events, not through the spawn function's return value.
    const cwd = mkdtempSync(join(tmpdir(), "cursor-cwd-"));
    const recorder = createFakeSpawnWithOutput({});
    const agent = new CursorAgent({ spawn: recorder.spawn, binary: "/nonexistent/binary" });

    const result = await agent.run("p", { cwd });

    expect(result.kind).toBe("error");
  });

  test("includes --force flag", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cursor-cwd-"));
    const recorder = createFakeSpawnWithOutput({
      cursor: { exit: 0, stdout: "ok", stderr: "" },
    });
    const agent = new CursorAgent({ spawn: recorder.spawn });

    await agent.run("p", { cwd });

    expect(recorder.records).toHaveLength(1);
    const record = recorder.only();
    expect(record.argv).toContain("--force");
  });

  test("successful invocations report estimated usage from prompt + stdout", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cursor-cwd-"));
    const recorder = createFakeSpawnWithOutput({
      cursor: { exit: 0, stdout: "ok", stderr: "" },
    });
    const agent = new CursorAgent({ spawn: recorder.spawn });

    const result = await agent.run("p", { cwd });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.usage_source).toBe("estimated");
      expect(result.usage?.input_tokens).toBe(1);
      expect(result.usage?.output_tokens).toBe(1);
    }
  });

  test("attributionLabel returns mapped label for known CLI slug", () => {
    const agent = new CursorAgent({
      binary: "fake",
      model: "composer-2.5",
    });
    expect(agent.attributionLabel()).toBe("Composer 2.5");
  });

  test("attributionLabel returns raw string for unknown model ID", () => {
    const agent = new CursorAgent({
      binary: "fake",
      model: "claude-opus-4-8",
    });
    expect(agent.attributionLabel()).toBe("claude-opus-4-8");
  });

  test("attributionLabel returns default fallback when model is undefined", () => {
    const agent = new CursorAgent({ binary: "fake" });
    expect(agent.attributionLabel()).toBe("cursor (default model)");
  });

  test("accepts additionalReadDirs without breaking --workspace and --force", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cursor-cwd-"));
    const recorder = createFakeSpawnWithOutput({
      cursor: { exit: 0, stdout: "ok", stderr: "" },
    });
    const agent = new CursorAgent({ spawn: recorder.spawn });

    await agent.run("p", {
      cwd,
      additionalReadDirs: ["/abs/specs/foo", "/abs/specs/bar"],
    });

    expect(recorder.records).toHaveLength(1);
    const record = recorder.only();
    expect(record.argv).toContain("--force");
    expect(record.argv).toContain("--workspace");
    expect(record.argv).toContain(cwd);
  });
});
