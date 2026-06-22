import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { runGhCommand, withSyncTransientRetry } from "../src/gh.ts";

function createFakeChild(
  onSetup?: (child: EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }) => void,
): EventEmitter & { stdout: EventEmitter; stderr: EventEmitter } {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  if (onSetup) queueMicrotask(() => onSetup(child));
  return child;
}

function fakeSpawnEmittingError(err: NodeJS.ErrnoException): unknown {
  return () => createFakeChild((child) => child.emit("error", err));
}

function fakeSpawnReturning(exitCode: number, stdout = "", stderr = ""): unknown {
  return () =>
    createFakeChild((child) => {
      if (stdout) child.stdout.emit("data", Buffer.from(stdout));
      if (stderr) child.stderr.emit("data", Buffer.from(stderr));
      child.emit("close", exitCode);
    });
}

function fakeSpawnSequence(results: Array<{ exitCode: number; stdout?: string; stderr?: string }>): unknown {
  let callCount = 0;
  return () => {
    const result = results[Math.min(callCount, results.length - 1)];
    if (!result) throw new Error("fakeSpawnSequence: no results provided");
    callCount++;
    return createFakeChild((child) => {
      if (result.stdout) child.stdout.emit("data", Buffer.from(result.stdout));
      if (result.stderr) child.stderr.emit("data", Buffer.from(result.stderr));
      child.emit("close", result.exitCode);
    });
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

    const _result = await runGhCommand(["auth", "status"], undefined, {
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

    const _result = await runGhCommand(["gh", "auth", "status"], undefined, {
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

describe("withSyncTransientRetry on git push", () => {
  test("retries transient git push error and succeeds on later attempt", () => {
    let callCount = 0;
    const thunk = () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("connection reset");
      }
      // Second attempt succeeds
    };

    withSyncTransientRetry(thunk, { op: "git push" });
    expect(callCount).toBe(2);
  });

  test("stops retrying after cap (3 total invocations) for transient push", () => {
    let callCount = 0;
    const thunk = () => {
      callCount++;
      throw new Error("TLS handshake timeout");
    };

    expect(() => {
      withSyncTransientRetry(thunk, { op: "git push" });
    }).toThrow("TLS handshake timeout");

    expect(callCount).toBe(3);
  });

  test("does not retry on permanent push failure (non-fast-forward)", () => {
    let callCount = 0;
    const thunk = () => {
      callCount++;
      throw new Error("failed to push some refs to 'origin'");
    };

    expect(() => {
      withSyncTransientRetry(thunk, { op: "git push" });
    }).toThrow("failed to push some refs");

    expect(callCount).toBe(1);
  });

  test("preserves error message on permanent failure for caller try/catch", () => {
    const originalError = "fatal: refusing to merge unrelated histories";
    const thunk = () => {
      throw new Error(originalError);
    };

    let caughtMessage = "";
    try {
      withSyncTransientRetry(thunk, { op: "git push" });
    } catch (err) {
      caughtMessage = err instanceof Error ? err.message : String(err);
    }

    expect(caughtMessage).toBe(originalError);
  });

  test("invokes sleep seam once per re-attempt", () => {
    const sleepCalls: number[] = [];
    let callCount = 0;
    const thunk = () => {
      callCount++;
      if (callCount <= 2) {
        throw new Error("connection reset");
      }
    };

    withSyncTransientRetry(thunk, {
      op: "git push",
      sleepSync: (ms: number) => {
        sleepCalls.push(ms);
      },
    });

    // 3 attempts = 2 re-attempts = 2 sleeps
    expect(sleepCalls).toHaveLength(2);
    expect(sleepCalls[0]).toBe(1000);
    expect(sleepCalls[1]).toBe(1000);
  });

  test("emits retry line via onRetry callback", () => {
    const retryLines: string[] = [];
    let callCount = 0;
    const thunk = () => {
      callCount++;
      if (callCount <= 2) {
        throw new Error("connection timed out");
      }
    };

    withSyncTransientRetry(thunk, {
      op: "git push",
      onRetry: (line: string) => {
        retryLines.push(line);
      },
      sleepSync: () => {},
    });

    expect(retryLines).toHaveLength(2);
    expect(retryLines[0]).toContain("git push");
    expect(retryLines[0]).toContain("attempt 2/3");
    expect(retryLines[1]).toContain("git push");
    expect(retryLines[1]).toContain("attempt 3/3");
  });
});

describe("withSyncTransientRetry on gh pr ready", () => {
  test("retries transient gh pr ready error and succeeds on later attempt", () => {
    let callCount = 0;
    const thunk = () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("TLS handshake timeout");
      }
    };

    withSyncTransientRetry(thunk, { op: "gh pr ready", isPrReady: true });
    expect(callCount).toBe(2);
  });

  test("stops retrying after cap (3 total invocations) for transient gh pr ready", () => {
    let callCount = 0;
    const thunk = () => {
      callCount++;
      throw new Error("could not resolve host");
    };

    expect(() => {
      withSyncTransientRetry(thunk, { op: "gh pr ready", isPrReady: true });
    }).toThrow("could not resolve host");

    expect(callCount).toBe(3);
  });

  test("treats 'already ready' stderr as success (lost-ack case)", () => {
    let callCount = 0;
    const thunk = () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("error: this pull request is not a draft");
      }
    };

    // Should not throw
    withSyncTransientRetry(thunk, { op: "gh pr ready", isPrReady: true });
    expect(callCount).toBe(1);
  });

  test("treats 'already ready' (alternate phrasing) as success", () => {
    let callCount = 0;
    const thunk = () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("error: pull request is already ready for review");
      }
    };

    withSyncTransientRetry(thunk, { op: "gh pr ready", isPrReady: true });
    expect(callCount).toBe(1);
  });

  test("does not retry on permanent gh pr ready failure (BLOCKED)", () => {
    let callCount = 0;
    const thunk = () => {
      callCount++;
      throw new Error("error: Pull request is blocked by branch protection rule");
    };

    expect(() => {
      withSyncTransientRetry(thunk, { op: "gh pr ready", isPrReady: true });
    }).toThrow("Pull request is blocked");

    expect(callCount).toBe(1);
  });

  test("does not retry on permanent gh pr ready failure (not authenticated)", () => {
    let callCount = 0;
    const thunk = () => {
      callCount++;
      throw new Error("AUTHENTICATION FAILED");
    };

    expect(() => {
      withSyncTransientRetry(thunk, { op: "gh pr ready", isPrReady: true });
    }).toThrow("AUTHENTICATION FAILED");

    expect(callCount).toBe(1);
  });

  test("preserves error message on permanent gh pr ready failure", () => {
    const originalError = "error: 404 Not Found";
    const thunk = () => {
      throw new Error(originalError);
    };

    let caughtMessage = "";
    try {
      withSyncTransientRetry(thunk, { op: "gh pr ready", isPrReady: true });
    } catch (err) {
      caughtMessage = err instanceof Error ? err.message : String(err);
    }

    expect(caughtMessage).toBe(originalError);
  });
});
