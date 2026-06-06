import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CursorAgent } from "../../src/agents/cursor.ts";

let dir: string;
let cwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-cursor-"));
  cwd = mkdtempSync(join(tmpdir(), "jarvis-cursor-cwd-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function fakeBinary(opts: { exit: number; stdout?: string; stderr?: string }): string {
  const path = join(dir, "cursor");
  const out = opts.stdout ?? "";
  const err = opts.stderr ?? "";
  const script = `#!/usr/bin/env bash
: > "${dir}/argv"
for a in "$@"; do printf '%s\\0' "$a" >> "${dir}/argv"; done
pwd > "${dir}/cwd"
printf '%s' ${JSON.stringify(out)}
printf '%s' ${JSON.stringify(err)} 1>&2
exit ${opts.exit}
`;
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
}

describe("CursorAgent", () => {
  test("name is 'cursor'", () => {
    expect(new CursorAgent().name).toBe("cursor");
  });

  test("spawns `cursor agent -p --output-format text --workspace <cwd> <prompt>` in cwd, mapping exit 0 → ok", async () => {
    const bin = fakeBinary({ exit: 0, stdout: "hi-out", stderr: "hi-err" });
    const agent = new CursorAgent({ binary: bin });

    const result = await agent.run("the prompt", { cwd });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.stdout).toBe("hi-out");
      expect(result.stderr).toBe("hi-err");
      expect(result.usage_source).toBe("estimated");
      expect(result.usage?.input_tokens).toBeGreaterThan(0);
      expect(result.usage?.output_tokens).toBeGreaterThan(0);
    }
    const argv = readFileSync(join(dir, "argv"), "utf8");
    expect(argv).toBe(`agent\0-p\0--output-format\0text\0--force\0--workspace\0${cwd}\0the prompt\0`);
    const reportedCwd = readFileSync(join(dir, "cwd"), "utf8").trim();
    const resolvedReportedCwd = realpathSync(reportedCwd);
    const resolvedCwd = realpathSync(cwd);
    expect(resolvedReportedCwd).toBe(resolvedCwd);
  });

  test("includes model flag when model is configured", async () => {
    const bin = fakeBinary({ exit: 0 });
    const agent = new CursorAgent({ binary: bin, model: "Composer 2.5" });

    await agent.run("the prompt", { cwd });

    const argv = readFileSync(join(dir, "argv"), "utf8");
    expect(argv).toBe(
      `agent\0-p\0--output-format\0text\0--model\0composer-2.5\0--force\0--workspace\0${cwd}\0the prompt\0`,
    );
  });

  test("maps Composer 2.5 Fast to the fast CLI slug", async () => {
    const bin = fakeBinary({ exit: 0 });
    const agent = new CursorAgent({ binary: bin, model: "Composer 2.5 Fast" });

    await agent.run("the prompt", { cwd });

    const argv = readFileSync(join(dir, "argv"), "utf8");
    expect(argv).toContain("--model\0composer-2.5-fast\0");
  });

  test("non-zero exit maps to error with captured stderr", async () => {
    const bin = fakeBinary({ exit: 2, stderr: "boom" });
    const agent = new CursorAgent({ binary: bin });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "error", exitCode: 2, stderr: "boom" });
  });

  test("non-zero exit includes captured stdout diagnostics", async () => {
    const bin = fakeBinary({ exit: 1, stdout: "No Cursor IDE installation" });
    const agent = new CursorAgent({ binary: bin });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({
      kind: "error",
      exitCode: 1,
      stderr: "No Cursor IDE installation",
    });
  });

  test("quota signal maps to quota", async () => {
    const stderr = "Error: You've hit your usage limit";
    const bin = fakeBinary({ exit: 1, stderr });
    const agent = new CursorAgent({ binary: bin });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "quota", stderr });
  });

  test("unsupported model signal maps to model_config", async () => {
    const stdout = "error: not available for your account";
    const bin = fakeBinary({ exit: 1, stdout });
    const agent = new CursorAgent({ binary: bin, model: "Composer 2" });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "model_config", stderr: stdout });
  });

  test("quota signal can be read from stdout", async () => {
    const stdout = "Error: You've hit your usage limit";
    const bin = fakeBinary({ exit: 1, stdout });
    const agent = new CursorAgent({ binary: bin });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "quota", stderr: stdout });
  });

  test("missing binary surfaces as error result, not a thrown exception", async () => {
    const agent = new CursorAgent({ binary: join(dir, "does-not-exist") });
    const result = await agent.run("p", { cwd });
    expect(result.kind).toBe("error");
  });

  test("includes --force flag", async () => {
    const bin = fakeBinary({ exit: 0 });
    const agent = new CursorAgent({ binary: bin });

    await agent.run("p", { cwd });

    const argv = readFileSync(join(dir, "argv"), "utf8");
    expect(argv).toContain("--force");
  });

  test("successful invocations report estimated usage from prompt + stdout", async () => {
    const bin = fakeBinary({ exit: 0, stdout: "ok" });
    const agent = new CursorAgent({ binary: bin });

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
    const bin = fakeBinary({ exit: 0 });
    const agent = new CursorAgent({ binary: bin });

    await agent.run("p", {
      cwd,
      additionalReadDirs: ["/abs/specs/foo", "/abs/specs/bar"],
    });

    const argv = readFileSync(join(dir, "argv"), "utf8");
    expect(argv).toContain("--force");
    expect(argv).toContain("--workspace");
    expect(argv).toContain(cwd);
  });
});
