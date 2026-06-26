import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexAgent } from "../../src/agents/codex.ts";
import { createFakeSpawnWithOutput } from "./fake-spawn.ts";

function prepareTempDirs() {
  const home = mkdtempSync(join(tmpdir(), "codex-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "codex-cwd-"));
  return { home, cwd };
}

function withHome<T>(home: string, fn: () => T | Promise<T>): T | Promise<T> {
  const oldHome = process.env.HOME;
  process.env.HOME = home;
  try {
    return fn();
  } finally {
    if (oldHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = oldHome;
    }
  }
}

function _expectAugmentedPrompt(stdin: string, basePrompt: string): void {
  expect(stdin.startsWith(`${basePrompt}\n`)).toBe(true);
  expect(stdin).toMatch(/<!-- jarvis-codex-invocation: [0-9a-f-]{36} -->$/);
}

describe("CodexAgent", () => {
  test("name is 'codex'", () => {
    expect(new CodexAgent().name).toBe("codex");
  });

  test("spawns `codex exec --color never` with prompt on stdin in cwd, mapping exit 0 → ok", async () => {
    const { home, cwd } = prepareTempDirs();
    await withHome(home, async () => {
      const recorder = createFakeSpawnWithOutput({
        codex: { exit: 0, stdout: "hi-out", stderr: "hi-err" },
      });
      const agent = new CodexAgent({ spawn: recorder.spawn });

      const result = await agent.run("the prompt", { cwd });

      expect(result.kind).toBe("ok");
      if (result.kind === "ok") {
        expect(result.stdout).toBe("hi-out");
        expect(result.stderr).toBe("hi-err");
      }
      expect(recorder.records).toHaveLength(1);
      const record = recorder.only();
      expect(record.binary).toBe("codex");
      expect(record.argv).toEqual([
        "exec",
        "--color",
        "never",
        "--sandbox",
        "workspace-write",
        "-c",
        'approval_policy="on-request"',
      ]);
      expect(record.opts.cwd).toBe(cwd);
    });
  });

  test("includes model flag when model is configured", async () => {
    const { home, cwd } = prepareTempDirs();
    await withHome(home, async () => {
      const recorder = createFakeSpawnWithOutput({
        codex: { exit: 0, stdout: "ok", stderr: "" },
      });
      const agent = new CodexAgent({ spawn: recorder.spawn, model: "gpt-5.4" });

      await agent.run("the prompt", { cwd });

      expect(recorder.records).toHaveLength(1);
      const record = recorder.only();
      expect(record.argv).toContain("--model");
      expect(record.argv).toContain("gpt-5.4");
    });
  });

  test("non-zero exit maps to error with captured stderr", async () => {
    const { home, cwd } = prepareTempDirs();
    await withHome(home, async () => {
      const recorder = createFakeSpawnWithOutput({
        codex: { exit: 2, stdout: "", stderr: "boom" },
      });
      const agent = new CodexAgent({ spawn: recorder.spawn });

      const result = await agent.run("p", { cwd });

      expect(result).toEqual({ kind: "error", exitCode: 2, stderr: "boom" });
    });
  });

  test("non-zero exit includes captured stdout diagnostics", async () => {
    const { home, cwd } = prepareTempDirs();
    await withHome(home, async () => {
      const recorder = createFakeSpawnWithOutput({
        codex: { exit: 1, stdout: "Not authenticated", stderr: "" },
      });
      const agent = new CodexAgent({ spawn: recorder.spawn });

      const result = await agent.run("p", { cwd });

      expect(result).toEqual({
        kind: "error",
        exitCode: 1,
        stderr: "Not authenticated",
      });
    });
  });

  test("quota signal maps to quota", async () => {
    const { home, cwd } = prepareTempDirs();
    await withHome(home, async () => {
      const stderr = "You've reached your usage limit. Try again later.";
      const recorder = createFakeSpawnWithOutput({
        codex: { exit: 1, stdout: "", stderr },
      });
      const agent = new CodexAgent({ spawn: recorder.spawn });

      const result = await agent.run("p", { cwd });

      expect(result).toEqual({ kind: "quota", stderr });
    });
  });

  test("unsupported model signal maps to model_config", async () => {
    const { home, cwd } = prepareTempDirs();
    await withHome(home, async () => {
      const stderr = "error: model is not available";
      const recorder = createFakeSpawnWithOutput({
        codex: { exit: 1, stdout: "", stderr },
      });
      const agent = new CodexAgent({ spawn: recorder.spawn, model: "gpt-5.4" });

      const result = await agent.run("p", { cwd });

      expect(result).toEqual({ kind: "model_config", stderr });
    });
  });

  test("quota signal can be read from stdout", async () => {
    const { home, cwd } = prepareTempDirs();
    await withHome(home, async () => {
      const stdout = "You've reached your usage limit. Try again later.";
      const recorder = createFakeSpawnWithOutput({
        codex: { exit: 1, stdout, stderr: "" },
      });
      const agent = new CodexAgent({ spawn: recorder.spawn });

      const result = await agent.run("p", { cwd });

      expect(result).toEqual({ kind: "quota", stderr: stdout });
    });
  });

  test.skip("missing binary surfaces as error result, not a thrown exception", async () => {
    // This test requires real spawn behavior to detect ENOENT; the fake spawn cannot simulate this.
    // Agents handle missing binaries through spawn error events, not through the spawn function's return value.
    const { home, cwd } = prepareTempDirs();
    await withHome(home, async () => {
      const recorder = createFakeSpawnWithOutput({});
      const agent = new CodexAgent({ spawn: recorder.spawn, binary: "/nonexistent/binary" });

      const result = await agent.run("p", { cwd });

      expect(result.kind).toBe("error");
    });
  });

  test('includes --sandbox workspace-write and approval_policy="on-request"', async () => {
    const { home, cwd } = prepareTempDirs();
    await withHome(home, async () => {
      const recorder = createFakeSpawnWithOutput({
        codex: { exit: 0, stdout: "ok", stderr: "" },
      });
      const agent = new CodexAgent({ spawn: recorder.spawn });

      await agent.run("p", { cwd });

      expect(recorder.records).toHaveLength(1);
      const record = recorder.only();
      expect(record.argv).toContain("--sandbox");
      expect(record.argv).toContain("workspace-write");
      expect(record.argv).toContain("-c");
      expect(record.argv).toContain('approval_policy="on-request"');
    });
  });

  test("appends --add-dir for each additionalReadDirs entry with existing sandbox and approval flags", async () => {
    const { home, cwd } = prepareTempDirs();
    await withHome(home, async () => {
      const recorder = createFakeSpawnWithOutput({
        codex: { exit: 0, stdout: "ok", stderr: "" },
      });
      const agent = new CodexAgent({ spawn: recorder.spawn });

      await agent.run("p", {
        cwd,
        additionalReadDirs: ["/abs/specs/foo", "/abs/specs/bar"],
      });

      expect(recorder.records).toHaveLength(1);
      const record = recorder.only();
      expect(record.argv).toContain("--add-dir");
      expect(record.argv).toContain("/abs/specs/foo");
      expect(record.argv).toContain("/abs/specs/bar");
    });
  });

  test("omits --add-dir when additionalReadDirs is unset", async () => {
    const { home, cwd } = prepareTempDirs();
    await withHome(home, async () => {
      const recorder = createFakeSpawnWithOutput({
        codex: { exit: 0, stdout: "ok", stderr: "" },
      });
      const agent = new CodexAgent({ spawn: recorder.spawn });

      await agent.run("p", { cwd });

      expect(recorder.records).toHaveLength(1);
      const record = recorder.only();
      expect(record.argv).not.toContain("--add-dir");
    });
  });

  test("attributionLabel returns raw string for model ID", () => {
    const agent = new CodexAgent({
      binary: "fake",
      model: "gpt-4-codex",
    });
    expect(agent.attributionLabel()).toBe("gpt-4-codex");
  });

  test("attributionLabel returns default fallback when model is undefined", () => {
    const agent = new CodexAgent({ binary: "fake" });
    expect(agent.attributionLabel()).toBe("codex (default model)");
  });

  test("records unavailable usage when no session file changes after invocation", async () => {
    const { home, cwd } = prepareTempDirs();
    await withHome(home, async () => {
      const recorder = createFakeSpawnWithOutput({
        codex: { exit: 0, stdout: "ok", stderr: "" },
      });
      const agent = new CodexAgent({ spawn: recorder.spawn });

      const result = await agent.run("prompt", { cwd });

      expect(result.kind).toBe("ok");
      if (result.kind === "ok") {
        expect(result.usage).toBeUndefined();
        expect(result.usage_source).toBe("unavailable");
        expect(result.cost_source).toBe("no-usage");
        expect(result.cost_usd).toBeNull();
        expect(result.warnings?.some((w) => w.includes("no session JSONL changed"))).toBe(true);
      }
    });
  });
});
