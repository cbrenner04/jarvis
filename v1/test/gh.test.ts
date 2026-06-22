import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { runGhCommand, type GhCommandOptions } from "../src/gh.ts";

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

function fakeSpawnReturning(exitCode: number, stdout = "", stderr = ""): unknown {
  return (_cmd: string, _args: string[], _opts: unknown) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      if (stdout) {
        child.stdout.emit("data", Buffer.from(stdout));
      }
      if (stderr) {
        child.stderr.emit("data", Buffer.from(stderr));
      }
      child.emit("close", exitCode);
    });
    return child;
  };
}

function fakeSpawnSequence(results: Array<{ exitCode: number; stdout?: string; stderr?: string }>): unknown {
  let callCount = 0;
  return (_cmd: string, _args: string[], _opts: unknown) => {
    const result = results[Math.min(callCount, results.length - 1)];
    if (!result) throw new Error("fakeSpawnSequence: no results provided");
    callCount++;
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      if (result.stdout) {
        child.stdout.emit("data", Buffer.from(result.stdout));
      }
      if (result.stderr) {
        child.stderr.emit("data", Buffer.from(result.stderr));
      }
      child.emit("close", result.exitCode);
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

    expect(Object.keys(result).sort()).toEqual(["exitCode", "stderr", "stdout"]);
  });
});

describe("runGhCommand retry on transient errors", () => {
  test("retries transient gh error and returns success on later attempt", async () => {
    // First attempt: transient TLS timeout, second attempt: success
    // biome-ignore lint/suspicious/noExplicitAny: injecting a test-only spawn
    const fakeSpawn = fakeSpawnSequence([
      { exitCode: 1, stderr: "TLS handshake timeout" },
      { exitCode: 0, stdout: "success output" },
    ]) as any;

    const result = await runGhCommand(["auth", "status"], undefined, {
      spawnImpl: fakeSpawn,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("success output");
  });

  test("retries on DNS resolution failure", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: injecting a test-only spawn
    const fakeSpawn = fakeSpawnSequence([
      { exitCode: 1, stderr: "could not resolve host" },
      { exitCode: 0, stdout: "resolved" },
    ]) as any;

    const result = await runGhCommand(["repo", "view"], undefined, {
      spawnImpl: fakeSpawn,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("resolved");
  });

  test("retries on operation timeout", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: injecting a test-only spawn
    const fakeSpawn = fakeSpawnSequence([
      { exitCode: 1, stderr: "operation timed out" },
      { exitCode: 0, stdout: "completed" },
    ]) as any;

    const result = await runGhCommand(["pr", "comment"], undefined, {
      spawnImpl: fakeSpawn,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("completed");
  });

  test("stops retrying after cap (3 total invocations)", async () => {
    let invocationCount = 0;
    // biome-ignore lint/suspicious/noExplicitAny: injecting a test-only spawn
    const fakeSpawn = ((_cmd: string, _args: string[], _opts: unknown) => {
      invocationCount++;
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        child.stderr.emit("data", Buffer.from("TLS handshake timeout"));
        child.emit("close", 1);
      });
      return child;
    }) as any;

    const result = await runGhCommand(["auth", "status"], undefined, {
      spawnImpl: fakeSpawn,
    });

    expect(invocationCount).toBe(3);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("TLS handshake timeout");
  });

  test("does not retry on permanent failure (exit 0)", async () => {
    let invocationCount = 0;
    // biome-ignore lint/suspicious/noExplicitAny: injecting a test-only spawn
    const fakeSpawn = ((_cmd: string, _args: string[], _opts: unknown) => {
      invocationCount++;
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from("success"));
        child.emit("close", 0);
      });
      return child;
    }) as any;

    const result = await runGhCommand(["auth", "status"], undefined, {
      spawnImpl: fakeSpawn,
    });

    expect(invocationCount).toBe(1);
    expect(result.exitCode).toBe(0);
  });

  test("does not retry on permanent gh failure (auth error)", async () => {
    let invocationCount = 0;
    // biome-ignore lint/suspicious/noExplicitAny: injecting a test-only spawn
    const fakeSpawn = ((_cmd: string, _args: string[], _opts: unknown) => {
      invocationCount++;
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        child.stderr.emit("data", Buffer.from("BLOCKED"));
        child.emit("close", 1);
      });
      return child;
    }) as any;

    const result = await runGhCommand(["pr", "comment"], undefined, {
      spawnImpl: fakeSpawn,
    });

    expect(invocationCount).toBe(1);
    expect(result.exitCode).toBe(1);
  });

  test("invokes sleep seam once per re-attempt", async () => {
    const sleepCalls: number[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: injecting a test-only spawn
    const fakeSpawn = fakeSpawnSequence([
      { exitCode: 1, stderr: "TLS handshake timeout" },
      { exitCode: 1, stderr: "TLS handshake timeout" },
      { exitCode: 0, stdout: "success" },
    ]) as any;

    const result = await runGhCommand(["auth", "status"], undefined, {
      spawnImpl: fakeSpawn,
      sleepMs: async (ms: number) => {
        sleepCalls.push(ms);
      },
    });

    // 3 attempts = 2 re-attempts = 2 sleeps
    expect(sleepCalls).toHaveLength(2);
    expect(sleepCalls[0]).toBe(1000);
    expect(sleepCalls[1]).toBe(1000);
  });

  test("emits retry line via onRetry callback", async () => {
    const retryLines: string[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: injecting a test-only spawn
    const fakeSpawn = fakeSpawnSequence([
      { exitCode: 1, stderr: "TLS handshake timeout" },
      { exitCode: 1, stderr: "operation timed out" },
      { exitCode: 0, stdout: "success" },
    ]) as any;

    const result = await runGhCommand(["gh", "auth", "status"], undefined, {
      spawnImpl: fakeSpawn,
      sleepMs: async () => {},
      onRetry: (line: string) => {
        retryLines.push(line);
      },
      op: "gh auth status",
    });

    expect(retryLines).toHaveLength(2);
    expect(retryLines[0]).toContain("gh auth status");
    expect(retryLines[0]).toContain("attempt 2/3");
    expect(retryLines[1]).toContain("gh auth status");
    expect(retryLines[1]).toContain("attempt 3/3");
  });

  test("backward compatibility: third param can be SpawnFn", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: injecting a test-only spawn
    const fakeSpawn = fakeSpawnReturning(0, "output") as any;

    const result = await runGhCommand(["auth", "status"], undefined, fakeSpawn);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("output");
  });
});
