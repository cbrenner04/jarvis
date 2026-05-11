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
import { OpencodeAgent } from "../../src/agents/opencode.ts";

let dir: string;
let cwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-opencode-"));
  cwd = mkdtempSync(join(tmpdir(), "jarvis-opencode-cwd-"));
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
  const path = join(dir, "opencode");
  const out = opts.stdout ?? "";
  const err = opts.stderr ?? "";
  const script = `#!/usr/bin/env bash
# Record argv (NUL-separated) and cwd so the test can inspect them.
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

describe("OpencodeAgent", () => {
  test("name is 'opencode'", () => {
    expect(String(new OpencodeAgent({ model: "AirProxy/test" }).name)).toBe(
      "opencode",
    );
  });

  test("spawns `opencode run` with model, format, and prompt positional in cwd", async () => {
    const bin = fakeBinary({ exit: 0, stdout: "hi-out", stderr: "hi-err" });
    const agent = new OpencodeAgent({
      binary: bin,
      model: "AirProxy/test",
    });

    const result = await agent.run("the prompt", { cwd });

    expect(result).toEqual({ kind: "ok", stdout: "hi-out", stderr: "hi-err" });
    expect(readFileSync(join(dir, "argv"), "utf8")).toBe(
      "run\0--model\0AirProxy/test\0--format\0default\0the prompt\0",
    );
    expect(readFileSync(join(dir, "cwd"), "utf8").trim()).toBe(
      realpathSync(cwd),
    );
  });

  test("does not pass a permissions bypass flag", async () => {
    const bin = fakeBinary({ exit: 0 });
    const agent = new OpencodeAgent({
      binary: bin,
      model: "AirProxy/test",
    });

    await agent.run("the prompt", { cwd });

    expect(readFileSync(join(dir, "argv"), "utf8")).not.toContain(
      "--dangerously-skip-permissions",
    );
  });

  test("non-zero exit maps to error with captured diagnostics", async () => {
    const bin = fakeBinary({ exit: 2, stdout: "out", stderr: "err" });
    const agent = new OpencodeAgent({
      binary: bin,
      model: "AirProxy/test",
    });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "error", exitCode: 2, stderr: "errout" });
  });

  test("quota signal maps to quota", async () => {
    const stderr = "error: rate limit reached";
    const bin = fakeBinary({ exit: 1, stderr });
    const agent = new OpencodeAgent({
      binary: bin,
      model: "AirProxy/test",
    });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "quota", stderr });
  });

  test("successful output with quota text stays ok", async () => {
    const stdout = "rate limit reached is example text";
    const bin = fakeBinary({ exit: 0, stdout });
    const agent = new OpencodeAgent({
      binary: bin,
      model: "AirProxy/test",
    });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "ok", stdout, stderr: "" });
  });

  test("unsupported model signal maps to model_config", async () => {
    const stderr = "error: model not found";
    const bin = fakeBinary({ exit: 1, stderr });
    const agent = new OpencodeAgent({
      binary: bin,
      model: "AirProxy/test",
    });

    const result = await agent.run("p", { cwd });

    expect(result).toEqual({ kind: "model_config", stderr });
  });

  test("missing binary surfaces as error result, not a thrown exception", async () => {
    const agent = new OpencodeAgent({
      binary: join(dir, "does-not-exist"),
      model: "AirProxy/test",
    });
    const result = await agent.run("p", { cwd });
    expect(result.kind).toBe("error");
  });
});
