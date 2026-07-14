import { describe, expect, test } from "bun:test";
import {
  branchExistsLocal,
  branchExistsLocalAsync,
  branchExistsOnOrigin,
  branchExistsOnOriginAsync,
  isGitRepoAsync,
  isWorktreeDirty,
  isWorktreeDirtyAsync,
} from "./git.ts";
import {
  AsyncSubprocessError,
  type AsyncSubprocessRunner,
  realAsyncSubprocessRunner,
  realSubprocessRunner,
  type SubprocessRunner,
} from "./subprocess.ts";

const cwd = process.cwd();
const utf8Payload = "café 🎉";

function fakeRunner(
  results: Record<string, string | Error>,
): SubprocessRunner & { calls: Array<{ args: string[]; cwd: string }> } {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  return {
    calls,
    run(cmd, args, runCwd) {
      calls.push({ args: [cmd, ...args], cwd: runCwd });
      const key = [cmd, ...args].join(" ");
      const result = results[key];
      if (result === undefined) throw new Error(`fakeRunner: no canned result for "${key}"`);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

function fakeAsyncRunner(
  results: Record<string, string | Error>,
): AsyncSubprocessRunner & { calls: Array<{ args: string[]; cwd: string }> } {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  return {
    calls,
    async runAsync(cmd, args, runCwd) {
      calls.push({ args: [cmd, ...args], cwd: runCwd });
      const key = [cmd, ...args].join(" ");
      const result = results[key];
      if (result === undefined) throw new Error(`fakeAsyncRunner: no canned result for "${key}"`);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

describe("realSubprocessRunner", () => {
  test("returns UTF-8 stdout", () => {
    const stdout = realSubprocessRunner.run(
      "node",
      ["-e", `process.stdout.write(${JSON.stringify(utf8Payload)})`],
      cwd,
    );
    expect(stdout).toBe(utf8Payload);
  });

  test("throws on non-zero exit", () => {
    expect(() => realSubprocessRunner.run("node", ["-e", "process.exit(2)"], cwd)).toThrow();
  });
});

describe("realAsyncSubprocessRunner", () => {
  test("returns UTF-8 stdout", async () => {
    const stdout = await realAsyncSubprocessRunner.runAsync(
      "node",
      ["-e", `process.stdout.write(${JSON.stringify(utf8Payload)})`],
      cwd,
    );
    expect(stdout).toBe(utf8Payload);
  });

  test("rejects with exit status and captured output on non-zero exit", async () => {
    const result = realAsyncSubprocessRunner.runAsync(
      "node",
      ["-e", "process.stdout.write('out'); process.stderr.write('err'); process.exit(2)"],
      cwd,
    );

    await expect(result).rejects.toBeInstanceOf(AsyncSubprocessError);
    await expect(result).rejects.toMatchObject({ status: 2, stdout: "out", stderr: "err" });
  });

  test("accepts output beyond Node's default maxBuffer when configured", async () => {
    const stdout = await realAsyncSubprocessRunner.runAsync(
      "node",
      ["-e", "process.stdout.write('x'.repeat(2 * 1024 * 1024))"],
      cwd,
      { maxBuffer: 3 * 1024 * 1024 },
    );

    expect(stdout).toHaveLength(2 * 1024 * 1024);
  });

  test("stdio ignore resolves to empty string", async () => {
    const stdout = await realAsyncSubprocessRunner.runAsync(
      "node",
      ["-e", `process.stdout.write(${JSON.stringify(utf8Payload)})`],
      cwd,
      { stdio: "ignore" },
    );
    expect(stdout).toBe("");
  });

  test("env option overrides child process environment", async () => {
    const stdout = await realAsyncSubprocessRunner.runAsync(
      "sh",
      ["-c", "echo $TEST_VAR"],
      cwd,
      { env: { TEST_VAR: "override" } },
    );
    expect(stdout.trim()).toBe("override");
  });

  test("omitting env preserves inherited environment", async () => {
    process.env.TEST_INHERITED = "present";
    const stdout = await realAsyncSubprocessRunner.runAsync(
      "sh",
      ["-c", "echo $TEST_INHERITED"],
      cwd,
    );
    expect(stdout.trim()).toBe("present");
    delete process.env.TEST_INHERITED;
  });
});

describe("predicate parity", () => {
  test("branchExistsLocal and branchExistsLocalAsync agree on success and failure", async () => {
    const syncExists = fakeRunner({ "git rev-parse --verify feature": "abc123\n" });
    const syncMissing = fakeRunner({ "git rev-parse --verify nope": new Error("not a valid ref") });
    const asyncExists = fakeAsyncRunner({ "git rev-parse --verify feature": "abc123\n" });
    const asyncMissing = fakeAsyncRunner({ "git rev-parse --verify nope": new Error("not a valid ref") });

    expect(branchExistsLocal("/repo", "feature", syncExists)).toBe(true);
    expect(await branchExistsLocalAsync("/repo", "feature", asyncExists)).toBe(true);
    expect(branchExistsLocal("/repo", "nope", syncMissing)).toBe(false);
    expect(await branchExistsLocalAsync("/repo", "nope", asyncMissing)).toBe(false);
  });

  test("branchExistsOnOrigin and branchExistsOnOriginAsync agree on success and failure", async () => {
    const syncExists = fakeRunner({ "git rev-parse --verify origin/main": "def456\n" });
    const syncMissing = fakeRunner({ "git rev-parse --verify origin/nope": new Error("not a valid ref") });
    const asyncExists = fakeAsyncRunner({ "git rev-parse --verify origin/main": "def456\n" });
    const asyncMissing = fakeAsyncRunner({ "git rev-parse --verify origin/nope": new Error("not a valid ref") });

    expect(branchExistsOnOrigin("/repo", "main", syncExists)).toBe(true);
    expect(await branchExistsOnOriginAsync("/repo", "main", asyncExists)).toBe(true);
    expect(branchExistsOnOrigin("/repo", "nope", syncMissing)).toBe(false);
    expect(await branchExistsOnOriginAsync("/repo", "nope", asyncMissing)).toBe(false);
  });

  test("isWorktreeDirty and isWorktreeDirtyAsync agree on clean and dirty trees", async () => {
    const syncDirty = fakeRunner({ "git status --porcelain": " M src/file.ts\n" });
    const syncClean = fakeRunner({ "git status --porcelain": "" });
    const asyncDirty = fakeAsyncRunner({ "git status --porcelain": " M src/file.ts\n" });
    const asyncClean = fakeAsyncRunner({ "git status --porcelain": "" });

    expect(isWorktreeDirty("/repo", syncDirty)).toBe(true);
    expect(await isWorktreeDirtyAsync("/repo", asyncDirty)).toBe(true);
    expect(isWorktreeDirty("/repo", syncClean)).toBe(false);
    expect(await isWorktreeDirtyAsync("/repo", asyncClean)).toBe(false);
  });

  test("isGitRepoAsync treats rejection as false", async () => {
    const runner = fakeAsyncRunner({
      "git rev-parse --is-inside-work-tree": new Error("not a git repo"),
    });
    expect(await isGitRepoAsync("/plain-dir", runner)).toBe(false);
  });
});
