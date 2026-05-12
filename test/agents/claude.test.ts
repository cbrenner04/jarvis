import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeAgent } from "../../src/agents/claude.ts";

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

function fakeBinary(opts: {
  exit: number;
  stdout?: string;
  stderr?: string;
}): string {
  const path = join(dir, "claude");
  const out = opts.stdout ?? "";
  const err = opts.stderr ?? "";
  const script = `#!/usr/bin/env bash
# Record argv (NUL-separated), stdin, and cwd so the test can inspect them.
: > "${dir}/argv"
for a in "$@"; do printf '%s\\0' "$a" >> "${dir}/argv"; done
cat > "${dir}/stdin"
pwd > "${dir}/cwd"
printf '%s' ${JSON.stringify(out)}
printf '%s' ${JSON.stringify(err)} 1>&2
exit ${opts.exit}
`;
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
}

describe("ClaudeAgent", () => {
  test("name is 'claude'", () => {
    expect(new ClaudeAgent().name).toBe("claude");
  });

  test("spawns `claude -p` with prompt on stdin in cwd, mapping exit 0 → ok", async () => {
    const bin = fakeBinary({ exit: 0, stdout: "hi-out", stderr: "hi-err" });
    const agent = new ClaudeAgent({ binary: bin });

    const result = await agent.run("the prompt", { cwd });

    expect(result).toEqual({ kind: "ok", stdout: "hi-out", stderr: "hi-err" });
    expect(readFileSync(join(dir, "argv"), "utf8")).toBe(
      "-p\0--permission-mode\0acceptEdits\0",
    );
    expect(readFileSync(join(dir, "stdin"), "utf8")).toBe("the prompt");
    expect(readFileSync(join(dir, "cwd"), "utf8").trim()).toBe(
      realpathSync(cwd),
    );
  });

  test("includes model flag when model is configured", async () => {
    const bin = fakeBinary({ exit: 0 });
    const agent = new ClaudeAgent({ binary: bin, model: "haiku" });

    await agent.run("the prompt", { cwd });

    expect(readFileSync(join(dir, "argv"), "utf8")).toBe(
      "-p\0--permission-mode\0acceptEdits\0--model\0haiku\0",
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
      "-p\0--permission-mode\0acceptEdits\0--add-dir\0/abs/specs/foo\0--add-dir\0/abs/specs/bar\0",
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
});
