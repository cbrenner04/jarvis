import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChildProcessBinding, runInvocationChild } from "./spawn.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-invocation-spawn-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeExecutable(name: string, script: string): string {
  const path = join(dir, name);
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
}

describe("runInvocationChild", () => {
  test("returns ok output from a short-lived child", async () => {
    const command = writeExecutable(
      "ok",
      `#!/usr/bin/env bash
printf 'done'
`,
    );

    const result = await runInvocationChild({
      command,
      argv: [],
      cwd: dir,
    });

    expect(result).toEqual({ kind: "ok", stdout: "done", stderr: "" });
  });

  test("aborts via process-group kill and returns aborted error", async () => {
    const marker = join(dir, "descendant-done");
    const command = writeExecutable(
      "slow",
      `#!/usr/bin/env bash
marker="${marker}"
( sleep 300; printf done > "$marker" ) &
wait
`,
    );
    const controller = new AbortController();

    const pending = runInvocationChild({
      command,
      argv: [],
      cwd: dir,
      signal: controller.signal,
      abortKillGraceMs: 50,
    });
    setTimeout(() => controller.abort("kill"), 25);

    const result = await pending;
    expect(result).toEqual({
      kind: "error",
      exitCode: -1,
      stderr: "aborted: kill",
    });
    expect(() => readFileSync(marker, "utf8")).toThrow();
  });

  test("createChildProcessBinding forwards abort to runInvocationChild", async () => {
    const command = writeExecutable(
      "sleepy",
      `#!/usr/bin/env bash
sleep 300
`,
    );
    const controller = new AbortController();
    const binding = createChildProcessBinding({
      id: "child",
      command,
      buildArgv: () => [],
      abortKillGraceMs: 50,
    });

    const pending = binding.invoke({ prompt: "p", cwd: dir, signal: controller.signal });
    setTimeout(() => controller.abort("steering-kill"), 25);

    const result = await pending;
    expect(result).toEqual({
      kind: "error",
      exitCode: -1,
      stderr: "aborted: steering-kill",
    });
  });
});
