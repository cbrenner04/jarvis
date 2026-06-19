import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeAgent } from "../../src/agents/claude.ts";

const fixturesDir = join(import.meta.dir, "..", "fixtures", "claude");

let dir: string;
let cwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-claude-"));
  cwd = mkdtempSync(join(tmpdir(), "jarvis-claude-cwd-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function fakeBinary(opts: { exit: number; stdout?: string; stderr?: string }): string {
  const path = join(dir, "claude");
  const out = opts.stdout ?? "";
  const err = opts.stderr ?? "";
  const outB64 = Buffer.from(out).toString("base64");
  const errB64 = Buffer.from(err).toString("base64");
  const script = `#!/usr/bin/env bash
# Record argv (NUL-separated), stdin, and cwd so the test can inspect them.
: > "${dir}/argv"
for a in "$@"; do printf '%s\\0' "$a" >> "${dir}/argv"; done
cat > "${dir}/stdin"
pwd > "${dir}/cwd"
printf '%s' "$(printf '%s' '${outB64}' | base64 -d)"
printf '%s' "$(printf '%s' '${errB64}' | base64 -d)" 1>&2
exit ${opts.exit}
`;
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
}

function claudeJson(result: string): string {
  return JSON.stringify({ type: "result", result });
}

describe("ClaudeAgent", () => {
  test("name is 'claude'", () => {
    expect(new ClaudeAgent().name).toBe("claude");
  });

  test("spawns `claude -p` with prompt on stdin in cwd, mapping exit 0 → ok", async () => {
    const bin = fakeBinary({
      exit: 0,
      stdout: claudeJson("hi-out"),
      stderr: "hi-err",
    });
    const agent = new ClaudeAgent({ binary: bin });

    const result = await agent.run("the prompt", { cwd });

    expect(result).toEqual({ kind: "ok", stdout: "hi-out", stderr: "hi-err" });
    expect(readFileSync(join(dir, "argv"), "utf8")).toBe("-p\0--permission-mode\0acceptEdits\0--output-format\0json\0");
    expect(readFileSync(join(dir, "stdin"), "utf8")).toBe("the prompt");
    const reportedCwd = readFileSync(join(dir, "cwd"), "utf8").trim();
    const resolvedReportedCwd = realpathSync(reportedCwd);
    const resolvedCwd = realpathSync(cwd);
    expect(resolvedReportedCwd).toBe(resolvedCwd);
  });

  test("includes model flag when model is configured", async () => {
    const bin = fakeBinary({ exit: 0 });
    const agent = new ClaudeAgent({
      binary: bin,
      model: "haiku",
    });

    await agent.run("the prompt", { cwd });

    expect(readFileSync(join(dir, "argv"), "utf8")).toBe(
      "-p\0--permission-mode\0acceptEdits\0--model\0haiku\0--output-format\0json\0",
    );
  });

  test("non-zero exit maps to error with captured stderr", async () => {
    const bin = fakeBinary({ exit: 2, stderr: "boom" });
    const agent = new ClaudeAgent({ binary: bin });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "error", exitCode: 2, stderr: "boom" });
  });

  test("non-zero exit includes captured stdout diagnostics", async () => {
    const bin = fakeBinary({ exit: 1, stdout: "Not logged in" });
    const agent = new ClaudeAgent({ binary: bin });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({
      kind: "error",
      exitCode: 1,
      stderr: "Not logged in",
    });
  });

  test("quota signal maps to quota", async () => {
    const stderr = "You've hit your session limit · resets 3:45pm";
    const bin = fakeBinary({ exit: 1, stderr });
    const agent = new ClaudeAgent({ binary: bin });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "quota", stderr });
  });

  test("unsupported model signal maps to model_config", async () => {
    const stderr = "error: unknown model: haiku";
    const bin = fakeBinary({ exit: 1, stderr });
    const agent = new ClaudeAgent({ binary: bin, model: "haiku" });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "model_config", stderr });
  });

  test("quota signal can be read from stdout", async () => {
    const stdout = "You've hit your session limit · resets 3:45pm";
    const bin = fakeBinary({ exit: 1, stdout });
    const agent = new ClaudeAgent({ binary: bin });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "quota", stderr: stdout });
  });

  test("zero-exit monthly-spend-limit JSON envelope maps to quota with full stdout diagnostics", async () => {
    const stdout = readFileSync(join(fixturesDir, "2.1.142-monthly-spend-limit.json"), "utf8");
    const bin = fakeBinary({ exit: 0, stdout });
    const agent = new ClaudeAgent({ binary: bin });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "quota", stderr: stdout });
  });

  test("zero-exit structured errors without quota predicates remain ok", async () => {
    const stdout = JSON.stringify({
      type: "result",
      is_error: true,
      api_error_status: 500,
      result: "Internal server error",
    });
    const bin = fakeBinary({ exit: 0, stdout });
    const agent = new ClaudeAgent({ binary: bin });

    const result = await agent.run("p", { cwd });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.stdout).toBe("Internal server error");
    }
  });

  test("missing binary surfaces as error result, not a thrown exception", async () => {
    const agent = new ClaudeAgent({ binary: join(dir, "does-not-exist") });
    const result = await agent.run("p", { cwd });
    expect(result.kind).toBe("error");
  });

  test("appends --add-dir for each additionalReadDirs entry", async () => {
    const bin = fakeBinary({ exit: 0 });
    const agent = new ClaudeAgent({ binary: bin });

    await agent.run("p", {
      cwd,
      additionalReadDirs: ["/abs/specs/foo", "/abs/specs/bar"],
    });

    expect(readFileSync(join(dir, "argv"), "utf8")).toBe(
      "-p\0--permission-mode\0acceptEdits\0--add-dir\0/abs/specs/foo\0--add-dir\0/abs/specs/bar\0--output-format\0json\0",
    );
  });

  test("omits --add-dir when additionalReadDirs is unset", async () => {
    const bin = fakeBinary({ exit: 0 });
    const agent = new ClaudeAgent({ binary: bin });

    await agent.run("p", { cwd });

    expect(readFileSync(join(dir, "argv"), "utf8")).not.toContain("--add-dir");
  });

  test("includes --permission-mode acceptEdits flag", async () => {
    const bin = fakeBinary({ exit: 0 });
    const agent = new ClaudeAgent({ binary: bin });

    await agent.run("p", { cwd });

    const argv = readFileSync(join(dir, "argv"), "utf8");
    expect(argv).toContain("--permission-mode");
    expect(argv).toContain("acceptEdits");
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
});
