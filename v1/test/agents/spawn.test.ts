import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent } from "../../src/agents/spawn.ts";
import { createFakeSpawnRecorder, createFakeSpawnSequence } from "./fake-spawn.ts";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "jarvis-spawn-cwd-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("runAgent PWD/env normalization", () => {
  test("child spawn cwd and PWD env equal configured cwd, not parent's PWD", async () => {
    const recorder = createFakeSpawnRecorder();

    const result = await runAgent(
      {
        name: "claude",
        binary: "claude",
        cwd,
        buildArgv: () => [],
        stdio: ["ignore", "pipe", "pipe"],
        streamErrorPrefix: "test:",
        spawn: recorder.spawn,
      },
      "test",
      { cwd },
    );

    expect(result.kind).toBe("ok");
    const record = recorder.only();
    expect(record.opts.cwd).toBe(cwd);
    expect((record.opts.env as Record<string, string>).PWD).toBe(cwd);
  });

  test("spawned child env does not carry OLDPWD", async () => {
    const originalOldPwd = process.env.OLDPWD;
    process.env.OLDPWD = "/some/prior/dir";
    try {
      const recorder = createFakeSpawnRecorder();

      const result = await runAgent(
        {
          name: "claude",
          binary: "claude",
          cwd,
          buildArgv: () => [],
          stdio: ["ignore", "pipe", "pipe"],
          streamErrorPrefix: "test:",
          spawn: recorder.spawn,
        },
        "test",
        { cwd },
      );

      expect(result.kind).toBe("ok");
      expect((recorder.only().opts.env as Record<string, string>).OLDPWD).toBeUndefined();
    } finally {
      if (originalOldPwd === undefined) {
        delete process.env.OLDPWD;
      } else {
        process.env.OLDPWD = originalOldPwd;
      }
    }
  });
});

describe("runAgent process group reaping", () => {
  test("kill failure during reap leaves result unchanged", async () => {
    const recorder = createFakeSpawnRecorder();

    // Stub process.kill to throw on group-kill attempts; track invocations.
    const originalKill = process.kill.bind(process);
    let killAttempted = false;
    const killStub = (pid: number, signal?: string | number): true => {
      if (pid < 0 && signal === "SIGKILL") {
        killAttempted = true;
        throw new Error("kill stub failure");
      }
      return originalKill(pid, signal);
    };
    (process.kill as (pid: number, signal?: string | number) => true) = killStub;

    try {
      const result = await runAgent(
        {
          name: "claude",
          binary: "claude",
          cwd,
          buildArgv: () => [],
          stdio: ["ignore", "pipe", "pipe"],
          streamErrorPrefix: "test:",
          spawn: recorder.spawn,
        },
        "test",
        { cwd },
      );

      // Verify the reap was attempted (kill stub was invoked on group SIGKILL).
      expect(killAttempted).toBe(true);
      // Verify result kind and exit code are unchanged despite kill failure.
      expect(result.kind).toBe("ok");
    } finally {
      process.kill = originalKill;
    }
  });
});

describe("runAgent transient retry", () => {
  const noOpSleep = async () => {};
  const recordSleep =
    (recordedSleeps: number[]) =>
    async (delayMs: number): Promise<void> => {
      recordedSleeps.push(delayMs);
    };

  test("transient-then-success returns ok with no advancement", async () => {
    const recorder = createFakeSpawnSequence([
      { exit: 1, stderr: "error: connection closed" },
      { exit: 0, stdout: "success" },
    ]);

    const result = await runAgent(
      {
        name: "claude",
        binary: "claude",
        cwd,
        buildArgv: () => [],
        stdio: ["ignore", "pipe", "pipe"],
        streamErrorPrefix: "test:",
        spawn: recorder.spawn,
      },
      "test",
      { cwd, sleepMs: noOpSleep },
    );

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.stdout).toBe("success");
    }
    expect(recorder.records.length).toBe(2);
  });

  test("persistent transient returns error at cap of 3 retries", async () => {
    const recorder = createFakeSpawnSequence([{ exit: 1, stderr: "error: connection reset" }]);

    const recordedSleeps: number[] = [];
    const result = await runAgent(
      {
        name: "claude",
        binary: "claude",
        cwd,
        buildArgv: () => [],
        stdio: ["ignore", "pipe", "pipe"],
        streamErrorPrefix: "test:",
        spawn: recorder.spawn,
      },
      "test",
      { cwd, sleepMs: recordSleep(recordedSleeps) },
    );

    expect(result.kind).toBe("error");
    expect(recorder.records.length).toBe(4); // 1 initial + 3 retries
    expect(recordedSleeps).toEqual([1000, 2000, 4000]);
  });

  test("opencode UnknownError/500 is retried by the transient loop", async () => {
    const recorder = createFakeSpawnSequence([
      { exit: 1, stderr: "opencode: UnknownError: HTTP 500 Internal Server Error" },
      { exit: 0, stdout: "success" },
    ]);

    const retries: Array<{ attempt: number; cap: number; exitCode: number }> = [];
    const recordedSleeps: number[] = [];
    const result = await runAgent(
      {
        name: "opencode",
        binary: "opencode",
        cwd,
        buildArgv: () => [],
        stdio: ["ignore", "pipe", "pipe"],
        streamErrorPrefix: "opencode:",
        spawn: recorder.spawn,
      },
      "test",
      {
        cwd,
        sleepMs: recordSleep(recordedSleeps),
        onTransientRetry: ({ attempt, cap, exitCode }) => {
          retries.push({ attempt, cap, exitCode });
        },
      },
    );

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.stdout).toBe("success");
    }
    expect(recorder.records.length).toBe(2);
    expect(retries).toEqual([{ attempt: 1, cap: 3, exitCode: 1 }]);
    expect(recordedSleeps).toEqual([1000]);
  });

  test("opencode UnknownError/500 exhaustion returns error after retry cap", async () => {
    const stderr = "opencode: UnknownError: HTTP 500 Internal Server Error";
    const recorder = createFakeSpawnSequence([{ exit: 1, stderr }]);

    const retries: Array<{ attempt: number; cap: number; exitCode: number }> = [];
    const recordedSleeps: number[] = [];
    const result = await runAgent(
      {
        name: "opencode",
        binary: "opencode",
        cwd,
        buildArgv: () => [],
        stdio: ["ignore", "pipe", "pipe"],
        streamErrorPrefix: "opencode:",
        spawn: recorder.spawn,
      },
      "test",
      {
        cwd,
        sleepMs: recordSleep(recordedSleeps),
        onTransientRetry: ({ attempt, cap, exitCode }) => {
          retries.push({ attempt, cap, exitCode });
        },
      },
    );

    expect(result).toEqual({ kind: "error", exitCode: 1, stderr });
    expect(recorder.records.length).toBe(4);
    expect(retries).toEqual([
      { attempt: 1, cap: 3, exitCode: 1 },
      { attempt: 2, cap: 3, exitCode: 1 },
      { attempt: 3, cap: 3, exitCode: 1 },
    ]);
    expect(recordedSleeps).toEqual([1000, 2000, 4000]);
  });

  test("aborted invocation is not retried", async () => {
    const recorder = createFakeSpawnSequence([{ exit: 1, stderr: "error: connection closed" }]);

    let spawnCount = 0;
    const controller = new AbortController();
    const result = await runAgent(
      {
        name: "claude",
        binary: "claude",
        cwd,
        buildArgv: () => {
          spawnCount++;
          if (spawnCount === 1) {
            // Abort immediately after first spawn
            controller.abort("test-abort");
          }
          return [];
        },
        stdio: ["ignore", "pipe", "pipe"],
        streamErrorPrefix: "test:",
        spawn: recorder.spawn,
      },
      "test",
      { cwd, signal: controller.signal },
    );

    expect(result.kind).toBe("error");
    expect(spawnCount).toBe(1); // Only 1 spawn, no retries
  });

  test("onTransientRetry callback fires per attempt", async () => {
    const recorder = createFakeSpawnSequence([
      { exit: 42, stderr: "error: socket hang up" },
      { exit: 42, stderr: "error: socket hang up" },
      { exit: 0, stdout: "success" },
    ]);

    const retries: { attempt: number; cap: number; exitCode: number }[] = [];
    const result = await runAgent(
      {
        name: "claude",
        binary: "claude",
        cwd,
        buildArgv: () => [],
        stdio: ["ignore", "pipe", "pipe"],
        streamErrorPrefix: "test:",
        spawn: recorder.spawn,
      },
      "test",
      {
        cwd,
        onTransientRetry: (info) => {
          retries.push({ attempt: info.attempt, cap: info.cap, exitCode: info.exitCode });
        },
        sleepMs: noOpSleep,
      },
    );

    expect(result.kind).toBe("ok");
    expect(retries.length).toBe(2);
    expect(retries[0]).toEqual({ attempt: 1, cap: 3, exitCode: 42 });
    expect(retries[1]).toEqual({ attempt: 2, cap: 3, exitCode: 42 });
  });

  test("abort during backoff sleep returns immediately", async () => {
    const recorder = createFakeSpawnSequence([{ exit: 1, stderr: "error: connection reset" }]);

    let spawnCount = 0;
    const controller = new AbortController();
    let sleepAbortedDuring = false;

    const result = await runAgent(
      {
        name: "claude",
        binary: "claude",
        cwd,
        buildArgv: () => {
          spawnCount++;
          return [];
        },
        stdio: ["ignore", "pipe", "pipe"],
        streamErrorPrefix: "test:",
        spawn: recorder.spawn,
      },
      "test",
      {
        cwd,
        signal: controller.signal,
        sleepMs: async (delayMs, signal) => {
          // After the first spawn, we're in the backoff sleep.
          // Trigger abort mid-sleep to test the race.
          if (spawnCount === 1) {
            const abortPromise = new Promise<void>((resolve) => {
              const timeout = setTimeout(() => {
                resolve();
              }, delayMs);
              const handleAbort = () => {
                clearTimeout(timeout);
                sleepAbortedDuring = true;
                resolve();
              };
              signal?.addEventListener("abort", handleAbort);
              // Trigger abort after a small delay, in the middle of the sleep.
              setTimeout(() => {
                controller.abort("test-abort");
              }, 50);
            });
            await abortPromise;
          } else {
            await noOpSleep();
          }
        },
      },
    );

    // Should return error due to abort, not continue retrying.
    expect(result.kind).toBe("error");
    // Only 1 spawn before the abort kicked in during the first backoff sleep.
    expect(spawnCount).toBe(1);
    // Verify abort happened during the sleep.
    expect(sleepAbortedDuring).toBe(true);
  });
});
