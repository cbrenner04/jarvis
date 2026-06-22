import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AiderAgent } from "../../src/agents/aider.ts";
import { createFakeSpawnWithOutput } from "./fake-spawn.ts";

describe("AiderAgent", () => {
  test("name is 'aider'", () => {
    expect(String(new AiderAgent({ model: "ollama/llama3" }).name)).toBe("aider");
  });

  test("spawns aider with --message, --model, --yes-always, --no-auto-commits, --no-git, --no-stream, --no-show-model-warnings in cwd", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "aider-cwd-"));
    const recorder = createFakeSpawnWithOutput({
      aider: { exit: 0, stdout: "hi-out", stderr: "hi-err" },
    });
    const agent = new AiderAgent({
      spawn: recorder.spawn,
      model: "ollama/llama3",
    });

    const result = await agent.run("the prompt", { cwd });

    expect(result).toEqual({
      kind: "ok",
      stdout: "hi-out",
      stderr: "hi-err",
      usage_source: "estimated",
      usage: {
        input_tokens: expect.any(Number),
        output_tokens: expect.any(Number),
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    });
    expect(recorder.records).toHaveLength(1);
    const record = recorder.records[0]!;
    expect(record.argv).toContain("--message");
    expect(record.argv).toContain("the prompt");
    expect(record.argv).toContain("--model");
    expect(record.argv).toContain("ollama/llama3");
    expect(record.argv).toContain("--yes-always");
    expect(record.argv).toContain("--no-auto-commits");
    expect(record.argv).toContain("--no-git");
    expect(record.argv).toContain("--no-stream");
    expect(record.argv).toContain("--no-show-model-warnings");
  });

  test("does not pass a permissions bypass flag beyond --yes-always", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "aider-cwd-"));
    const recorder = createFakeSpawnWithOutput({
      aider: { exit: 0, stdout: "ok", stderr: "" },
    });
    const agent = new AiderAgent({
      spawn: recorder.spawn,
      model: "ollama/llama3",
    });

    await agent.run("the prompt", { cwd });

    expect(recorder.records).toHaveLength(1);
    const record = recorder.records[0]!;
    expect(record.argv).toContain("--yes-always");
    expect(record.argv).not.toContain("--dangerously");
    expect(record.argv).not.toContain("--skip");
  });

  test("non-zero exit maps to error with captured diagnostics", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "aider-cwd-"));
    const recorder = createFakeSpawnWithOutput({
      aider: { exit: 2, stdout: "out", stderr: "err" },
    });
    const agent = new AiderAgent({
      spawn: recorder.spawn,
      model: "ollama/llama3",
    });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "error", exitCode: 2, stderr: "errout" });
  });

  test("model not found signal maps to model_config", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "aider-cwd-"));
    const stderr = "error: LLM Provider NOT provided";
    const recorder = createFakeSpawnWithOutput({
      aider: { exit: 1, stdout: "", stderr },
    });
    const agent = new AiderAgent({
      spawn: recorder.spawn,
      model: "nonexistent-model",
    });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "model_config", stderr });
  });

  test("rate limit signal maps to quota", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "aider-cwd-"));
    const stderr = "error: rate limit reached";
    const recorder = createFakeSpawnWithOutput({
      aider: { exit: 1, stdout: "", stderr },
    });
    const agent = new AiderAgent({
      spawn: recorder.spawn,
      model: "ollama/llama3",
    });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "quota", stderr });
  });

  test("could not connect to ollama maps to model_config", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "aider-cwd-"));
    const stderr = "could not connect to ollama at http://localhost:11434";
    const recorder = createFakeSpawnWithOutput({
      aider: { exit: 1, stdout: "", stderr },
    });
    const agent = new AiderAgent({
      spawn: recorder.spawn,
      model: "ollama/llama3",
    });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "model_config", stderr });
  });

  test("successful output with model_config text stays ok", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "aider-cwd-"));
    const stdout = "unknown model is in the output";
    const recorder = createFakeSpawnWithOutput({
      aider: { exit: 0, stdout, stderr: "" },
    });
    const agent = new AiderAgent({
      spawn: recorder.spawn,
      model: "ollama/llama3",
    });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({
      kind: "ok",
      stdout,
      stderr: "",
      usage_source: "estimated",
      usage: {
        input_tokens: expect.any(Number),
        output_tokens: expect.any(Number),
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    });
  });

  test("successful invocations estimate usage from prompt + stdout", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "aider-cwd-"));
    const recorder = createFakeSpawnWithOutput({
      aider: { exit: 0, stdout: "ok", stderr: "" },
    });
    const agent = new AiderAgent({
      spawn: recorder.spawn,
      model: "ollama/llama3",
    });

    const result = await agent.run("p", { cwd });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.usage_source).toBe("estimated");
      expect(result.cost_source).toBeUndefined();
      expect(result.usage).toBeDefined();
      expect(result.usage?.input_tokens).toBeGreaterThan(0);
      expect(result.usage?.output_tokens).toBeGreaterThan(0);
      expect(result.usage?.cache_read_input_tokens).toBe(0);
      expect(result.usage?.cache_creation_input_tokens).toBe(0);
    }
  });

  test("estimator failure falls back to unavailable usage with one warning", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "aider-cwd-"));
    const recorder = createFakeSpawnWithOutput({
      aider: { exit: 0, stdout: "ok", stderr: "" },
    });
    const agent = new AiderAgent({
      spawn: recorder.spawn,
      model: "ollama/llama3",
      estimateUsage: () => null,
    });

    const result = await agent.run("p", { cwd });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.usage_source).toBe("unavailable");
      expect(result.cost_source).toBe("no-usage");
      expect(result.warnings).toEqual(["aider: token estimator unavailable; usage recorded as unavailable."]);
    }
  });

  test("attributionLabel returns raw string for model ID", () => {
    const agent = new AiderAgent({
      binary: "fake",
      model: "ollama/llama3",
    });
    expect(agent.attributionLabel()).toBe("ollama/llama3");
  });

  test("appends additionalReadDirs as positional arguments", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "aider-cwd-"));
    const recorder = createFakeSpawnWithOutput({
      aider: { exit: 0, stdout: "ok", stderr: "" },
    });
    const agent = new AiderAgent({
      spawn: recorder.spawn,
      model: "ollama/llama3",
    });

    const sibling1 = "/abs/sibling1";
    const sibling2 = "/abs/sibling2";

    await agent.run("prompt", {
      cwd,
      additionalReadDirs: [sibling1, sibling2],
    });

    expect(recorder.records).toHaveLength(1);
    const record = recorder.records[0]!;
    expect(record.argv).toContain(sibling1);
    expect(record.argv).toContain(sibling2);
  });

  test("additionalReadDirs with multiple entries appear as distinct positional args", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "aider-cwd-"));
    const recorder = createFakeSpawnWithOutput({
      aider: { exit: 0, stdout: "ok", stderr: "" },
    });
    const agent = new AiderAgent({
      spawn: recorder.spawn,
      model: "ollama/llama3",
    });

    const sibling1 = "/abs/repo1";
    const sibling2 = "/abs/repo2";
    const sibling3 = "/abs/repo3";

    await agent.run("prompt", {
      cwd,
      additionalReadDirs: [sibling1, sibling2, sibling3],
    });

    expect(recorder.records).toHaveLength(1);
    const record = recorder.records[0]!;
    expect(record.argv).toContain(sibling1);
    expect(record.argv).toContain(sibling2);
    expect(record.argv).toContain(sibling3);
    expect(record.argv).toContain("--yes-always");
    expect(record.argv).toContain("--no-auto-commits");
    expect(record.argv).toContain("--no-git");
    expect(record.argv).toContain("--no-stream");
  });

  test("passes BROWSER=false to the aider subprocess", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "aider-cwd-"));
    const recorder = createFakeSpawnWithOutput({
      aider: { exit: 0, stdout: "ok", stderr: "" },
    });
    const agent = new AiderAgent({ spawn: recorder.spawn, model: "ollama/llama3" });
    await agent.run("prompt", { cwd });

    expect(recorder.records).toHaveLength(1);
    const record = recorder.records[0]!;
    expect(record.opts.env).toBeDefined();
    expect(record.opts.env?.BROWSER).toBe("false");
  });
});
