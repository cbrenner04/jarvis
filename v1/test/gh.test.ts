import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { runGhCommand } from "../src/gh.ts";

function fakeSpawnEmittingError(err: NodeJS.ErrnoException): unknown {
  return () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      child.emit("error", err);
    });
    return child;
  };
}

describe("runGhCommand error handling", () => {
  test("ENOENT spawn error produces dedicated 'binary not found on PATH' stderr", async () => {
    const err = new Error("spawn gh ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    // biome-ignore lint/suspicious/noExplicitAny: injecting a test-only spawn
    const fakeSpawn = fakeSpawnEmittingError(err) as any;

    const result = await runGhCommand(["auth", "status"], undefined, fakeSpawn);

    expect(result.exitCode).toBe(-1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("gh: binary not found on PATH");
    expect(result.stderr).toContain("brew install gh");
  });

  test("non-ENOENT spawn error continues to surface String(err) in stderr", async () => {
    const err = new Error("permission denied") as NodeJS.ErrnoException;
    err.code = "EACCES";
    // biome-ignore lint/suspicious/noExplicitAny: injecting a test-only spawn
    const fakeSpawn = fakeSpawnEmittingError(err) as any;

    const result = await runGhCommand(["auth", "status"], undefined, fakeSpawn);

    expect(result.exitCode).toBe(-1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("permission denied");
    expect(result.stderr).not.toContain("gh: binary not found on PATH");
  });

  test("return shape (stdout, stderr, exitCode) is unchanged on error", async () => {
    const err = new Error("spawn gh ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    // biome-ignore lint/suspicious/noExplicitAny: injecting a test-only spawn
    const fakeSpawn = fakeSpawnEmittingError(err) as any;

    const result = await runGhCommand(["auth", "status"], undefined, fakeSpawn);

    expect(Object.keys(result).sort()).toEqual([
      "exitCode",
      "stderr",
      "stdout",
    ]);
  });
});
