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
import { CodexAgent } from "../../src/agents/codex.ts";

let dir: string;
let cwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-codex-"));
  cwd = mkdtempSync(join(tmpdir(), "jarvis-codex-cwd-"));
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
  const path = join(dir, "codex");
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

describe("CodexAgent", () => {
  test("name is 'codex'", () => {
    expect(new CodexAgent().name).toBe("codex");
  });

  test("spawns `codex exec --color never` with prompt on stdin in cwd, mapping exit 0 → ok", async () => {
    const bin = fakeBinary({ exit: 0, stdout: "hi-out", stderr: "hi-err" });
    const agent = new CodexAgent({ binary: bin });

    const result = await agent.run("the prompt", { cwd });

    expect(result).toEqual({ kind: "ok", stdout: "hi-out", stderr: "hi-err" });
    expect(readFileSync(join(dir, "argv"), "utf8")).toBe(
      "exec\0--color\0never\0--sandbox\0workspace-write\0--ask-for-approval\0on-request\0",
    );
    expect(readFileSync(join(dir, "stdin"), "utf8")).toBe("the prompt");
    expect(readFileSync(join(dir, "cwd"), "utf8").trim()).toBe(
      realpathSync(cwd),
    );
  });

  test("includes model flag when model is configured", async () => {
    const bin = fakeBinary({ exit: 0 });
    const agent = new CodexAgent({ binary: bin, model: "gpt-5.3-codex" });

    await agent.run("the prompt", { cwd });

    expect(readFileSync(join(dir, "argv"), "utf8")).toBe(
      "exec\0--color\0never\0--sandbox\0workspace-write\0--ask-for-approval\0on-request\0--model\0gpt-5.3-codex\0",
    );
  });

  test("non-zero exit maps to error with captured stderr", async () => {
    const bin = fakeBinary({ exit: 2, stderr: "boom" });
    const agent = new CodexAgent({ binary: bin });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "error", exitCode: 2, stderr: "boom" });
  });

  test("non-zero exit includes captured stdout diagnostics", async () => {
    const bin = fakeBinary({ exit: 1, stdout: "Not authenticated" });
    const agent = new CodexAgent({ binary: bin });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({
      kind: "error",
      exitCode: 1,
      stderr: "Not authenticated",
    });
  });

  test("quota signal maps to quota", async () => {
    const stderr = "You've reached your usage limit. Try again later.";
    const bin = fakeBinary({ exit: 1, stderr });
    const agent = new CodexAgent({ binary: bin });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "quota", stderr });
  });

  test("unsupported model signal maps to model_config", async () => {
    const stderr = "error: model is not available";
    const bin = fakeBinary({ exit: 1, stderr });
    const agent = new CodexAgent({ binary: bin, model: "gpt-5.3-codex" });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "model_config", stderr });
  });

  test("quota signal can be read from stdout", async () => {
    const stdout = "You've reached your usage limit. Try again later.";
    const bin = fakeBinary({ exit: 1, stdout });
    const agent = new CodexAgent({ binary: bin });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "quota", stderr: stdout });
  });

  test("missing binary surfaces as error result, not a thrown exception", async () => {
    const agent = new CodexAgent({ binary: join(dir, "does-not-exist") });
    const result = await agent.run("p", { cwd });
    expect(result.kind).toBe("error");
  });

  test("includes --sandbox workspace-write and --ask-for-approval on-request flags", async () => {
    const bin = fakeBinary({ exit: 0 });
    const agent = new CodexAgent({ binary: bin });

    await agent.run("p", { cwd });

    const argv = readFileSync(join(dir, "argv"), "utf8");
    expect(argv).toContain("--sandbox");
    expect(argv).toContain("workspace-write");
    expect(argv).toContain("--ask-for-approval");
    expect(argv).toContain("on-request");
  });
});
