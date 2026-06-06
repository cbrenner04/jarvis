import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AiderAgent } from "../../src/agents/aider.ts";

let dir: string;
let cwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-aider-"));
  cwd = mkdtempSync(join(tmpdir(), "jarvis-aider-cwd-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function fakeBinary(opts: { exit: number; stdout?: string; stderr?: string }): string {
  const path = join(dir, "aider");
  const out = opts.stdout ?? "";
  const err = opts.stderr ?? "";
  const script = `#!/usr/bin/env bash
# Record argv (NUL-separated) and cwd so the test can inspect them.
: > "${dir}/argv"
for a in "$@"; do printf '%s\\0' "$a" >> "${dir}/argv"; done
pwd > "${dir}/cwd"
printf '%s' "\${BROWSER:-__unset__}" > "${dir}/browser_env"
printf '%s' ${JSON.stringify(out)}
printf '%s' ${JSON.stringify(err)} 1>&2
exit ${opts.exit}
`;
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
}

describe("AiderAgent", () => {
  test("name is 'aider'", () => {
    expect(String(new AiderAgent({ model: "ollama/llama3" }).name)).toBe("aider");
  });

  test("spawns aider with --message, --model, --yes-always, --no-auto-commits, --no-git, --no-stream, --no-show-model-warnings in cwd", async () => {
    const bin = fakeBinary({ exit: 0, stdout: "hi-out", stderr: "hi-err" });
    const agent = new AiderAgent({
      binary: bin,
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
    const argv = readFileSync(join(dir, "argv"), "utf8");
    expect(argv).toContain("--message");
    expect(argv).toContain("the prompt");
    expect(argv).toContain("--model");
    expect(argv).toContain("ollama/llama3");
    expect(argv).toContain("--yes-always");
    expect(argv).toContain("--no-auto-commits");
    expect(argv).toContain("--no-git");
    expect(argv).toContain("--no-stream");
    expect(argv).toContain("--no-show-model-warnings");
    const reportedCwd = readFileSync(join(dir, "cwd"), "utf8").trim();
    const resolvedReportedCwd = realpathSync(reportedCwd);
    const resolvedCwd = realpathSync(cwd);
    expect(resolvedReportedCwd).toBe(resolvedCwd);
  });

  test("does not pass a permissions bypass flag beyond --yes-always", async () => {
    const bin = fakeBinary({ exit: 0 });
    const agent = new AiderAgent({
      binary: bin,
      model: "ollama/llama3",
    });

    await agent.run("the prompt", { cwd });

    const argv = readFileSync(join(dir, "argv"), "utf8");
    expect(argv).toContain("--yes-always");
    expect(argv).not.toContain("--dangerously");
    expect(argv).not.toContain("--skip");
  });

  test("non-zero exit maps to error with captured diagnostics", async () => {
    const bin = fakeBinary({ exit: 2, stdout: "out", stderr: "err" });
    const agent = new AiderAgent({
      binary: bin,
      model: "ollama/llama3",
    });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "error", exitCode: 2, stderr: "errout" });
  });

  test("model not found signal maps to model_config", async () => {
    const stderr = "error: LLM Provider NOT provided";
    const bin = fakeBinary({ exit: 1, stderr });
    const agent = new AiderAgent({
      binary: bin,
      model: "nonexistent-model",
    });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "model_config", stderr });
  });

  test("rate limit signal maps to quota", async () => {
    const stderr = "error: rate limit reached";
    const bin = fakeBinary({ exit: 1, stderr });
    const agent = new AiderAgent({
      binary: bin,
      model: "ollama/llama3",
    });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "quota", stderr });
  });

  test("could not connect to ollama maps to model_config", async () => {
    const stderr = "could not connect to ollama at http://localhost:11434";
    const bin = fakeBinary({ exit: 1, stderr });
    const agent = new AiderAgent({
      binary: bin,
      model: "ollama/llama3",
    });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "model_config", stderr });
  });

  test("successful output with model_config text stays ok", async () => {
    const stdout = "unknown model is in the output";
    const bin = fakeBinary({ exit: 0, stdout });
    const agent = new AiderAgent({
      binary: bin,
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
    const bin = fakeBinary({ exit: 0, stdout: "ok" });
    const agent = new AiderAgent({
      binary: bin,
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
    const bin = fakeBinary({ exit: 0, stdout: "ok" });
    const agent = new AiderAgent({
      binary: bin,
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

  test("missing binary surfaces as error result, not a thrown exception", async () => {
    const agent = new AiderAgent({
      binary: join(dir, "does-not-exist"),
      model: "ollama/llama3",
    });
    const result = await agent.run("p", { cwd });
    expect(result.kind).toBe("error");
  });

  test("attributionLabel returns raw string for model ID", () => {
    const agent = new AiderAgent({
      binary: "fake",
      model: "ollama/llama3",
    });
    expect(agent.attributionLabel()).toBe("ollama/llama3");
  });

  test("appends additionalReadDirs as positional arguments", async () => {
    const bin = fakeBinary({ exit: 0 });
    const agent = new AiderAgent({
      binary: bin,
      model: "ollama/llama3",
    });

    const sibling1 = join(dir, "sibling1");
    const sibling2 = join(dir, "sibling2");

    await agent.run("prompt", {
      cwd,
      additionalReadDirs: [sibling1, sibling2],
    });

    const argv = readFileSync(join(dir, "argv"), "utf8").split("\0");
    // Find the index of --message to check order
    const messageIdx = argv.indexOf("--message");
    expect(messageIdx).toBeGreaterThan(-1);

    // The sibling directories should appear after all the flags
    const argvString = readFileSync(join(dir, "argv"), "utf8");
    expect(argvString).toContain(sibling1);
    expect(argvString).toContain(sibling2);
  });

  test("additionalReadDirs with multiple entries appear as distinct positional args", async () => {
    const bin = fakeBinary({ exit: 0 });
    const agent = new AiderAgent({
      binary: bin,
      model: "ollama/llama3",
    });

    const sibling1 = join(dir, "repo1");
    const sibling2 = join(dir, "repo2");
    const sibling3 = join(dir, "repo3");

    await agent.run("prompt", {
      cwd,
      additionalReadDirs: [sibling1, sibling2, sibling3],
    });

    const argv = readFileSync(join(dir, "argv"), "utf8");
    expect(argv).toContain(sibling1);
    expect(argv).toContain(sibling2);
    expect(argv).toContain(sibling3);
    // Ensure all required flags are still present
    expect(argv).toContain("--yes-always");
    expect(argv).toContain("--no-auto-commits");
    expect(argv).toContain("--no-git");
    expect(argv).toContain("--no-stream");
  });

  test("passes BROWSER=false to the aider subprocess", async () => {
    const bin = fakeBinary({ exit: 0 });
    const agent = new AiderAgent({ binary: bin, model: "ollama/llama3" });
    await agent.run("prompt", { cwd });
    const browserEnv = readFileSync(join(dir, "browser_env"), "utf8");
    expect(browserEnv).toBe("false");
  });
});
