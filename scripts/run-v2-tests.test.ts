import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  aggregateExitCode,
  defaultConcurrency,
  defaultSpawn,
  fileOutputHeader,
  isSpawnTimeout,
  resolveConcurrency,
  runV2TestFiles,
  SUPPORTED_HEALTHY_FILE_BUDGET_MS,
  spawnTimeoutMessage,
  validatePerFileTimeout,
} from "./run-v2-tests.ts";

describe("isSpawnTimeout", () => {
  test("detects a SIGKILL with null status as a timeout", () => {
    expect(isSpawnTimeout({ signal: "SIGKILL", status: null })).toBe(true);
  });

  test("does not treat a normal SIGKILL exit as a timeout when status is set", () => {
    expect(isSpawnTimeout({ signal: "SIGKILL", status: 137 })).toBe(false);
  });

  test("does not treat a clean exit as a timeout", () => {
    expect(isSpawnTimeout({ signal: null, status: 0 })).toBe(false);
  });

  test("does not treat a non-SIGKILL signal as a timeout", () => {
    expect(isSpawnTimeout({ signal: "SIGTERM", status: null })).toBe(false);
  });
});

describe("spawnTimeoutMessage", () => {
  test("per-file loop names the mode and file", () => {
    expect(spawnTimeoutMessage("integration", "v2/src/foo.test.ts")).toBe(
      'error: v2 "integration" test run timed out or was killed on file "v2/src/foo.test.ts"\n',
    );
  });

  test("agent mode names the mode without a file", () => {
    expect(spawnTimeoutMessage("agent")).toBe('error: v2 "agent" test run timed out or was killed\n');
  });
});

describe("defaultConcurrency", () => {
  test.each([
    { parallelism: 18, expected: 9 },
    { parallelism: 4, expected: 2 },
    { parallelism: 3, expected: 1 },
    { parallelism: 1, expected: 1 },
  ])("halves a stubbed parallelism of $parallelism with a floor of 1", ({ parallelism, expected }) => {
    expect(defaultConcurrency(parallelism)).toBe(expected);
  });
});

describe("resolveConcurrency", () => {
  test("an explicit override wins over the env var and the derived default", () => {
    expect(resolveConcurrency(5, "3", 18)).toBe(5);
  });

  test("the env var wins over the derived default when no explicit override is given", () => {
    expect(resolveConcurrency(undefined, "3", 18)).toBe(3);
  });

  test("a malformed env var falls back to the derived default", () => {
    expect(resolveConcurrency(undefined, "not-a-number", 18)).toBe(9);
  });

  test("a zero env var falls back to the derived default", () => {
    expect(resolveConcurrency(undefined, "0", 18)).toBe(9);
  });

  test("an unset env var falls back to the derived default", () => {
    expect(resolveConcurrency(undefined, undefined, 18)).toBe(9);
  });

  test("an explicit zero is accepted (clamps to serial elsewhere)", () => {
    expect(resolveConcurrency(0, "3", 18)).toBe(0);
  });

  test("throws on a NaN explicit override instead of silently producing a zero-worker pool", () => {
    expect(() => resolveConcurrency(Number.NaN, "3", 18)).toThrow();
  });

  test("throws on a fractional explicit override", () => {
    expect(() => resolveConcurrency(1.5, "3", 18)).toThrow();
  });

  test("throws on a negative explicit override", () => {
    expect(() => resolveConcurrency(-1, "3", 18)).toThrow();
  });
});

describe("defaultSpawn", () => {
  test("prints then exceeds a small injected timeout: timedOut true with pre-kill output preserved", async () => {
    const outcome = await defaultSpawn("bash", ["-c", "echo hi; sleep 5"], { timeout: 200 });

    expect(outcome.timedOut).toBe(true);
    expect(outcome.stdout).toBe("hi\n");
  }, 3_000);

  test("a within-budget kill is reported as a failure, not a timeout", async () => {
    const outcome = await defaultSpawn("bash", ["-c", "kill -9 $$"], { timeout: SUPPORTED_HEALTHY_FILE_BUDGET_MS });

    expect(outcome.timedOut).toBe(false);
    expect(outcome.signal).toBe("SIGKILL");
  });

  test("a spawn error (e.g. ENOENT) settles as a failure instead of hanging", async () => {
    const outcome = await defaultSpawn("definitely-not-a-real-command-xyz", [], {
      timeout: SUPPORTED_HEALTHY_FILE_BUDGET_MS,
    });

    expect(outcome.timedOut).toBe(false);
    expect(outcome.status).not.toBe(0);
    expect(outcome.stderr).toContain("definitely-not-a-real-command-xyz");
  });
});

describe("runV2TestFiles", () => {
  afterEach(() => {
    // biome-ignore lint/suspicious/noExplicitAny: bun:test mock restore is untyped
    (process.stderr.write as any).mockRestore?.();
    // biome-ignore lint/suspicious/noExplicitAny: bun:test mock restore is untyped
    (process.stdout.write as any).mockRestore?.();
  });

  test("agent mode continues past a timed-out file and still runs the rest", async () => {
    const stderr = spyOn(process.stderr, "write").mockImplementation(() => true);
    spyOn(process.stdout, "write").mockImplementation(() => true);
    const calls: string[] = [];
    const spawn = async (_cmd: string, args: string[]) => {
      const file = args[1] ?? "";
      calls.push(file);
      if (file === "hung.test.ts") {
        return { status: null, signal: "SIGKILL" as const, stdout: "", stderr: "", timedOut: true };
      }
      return { status: 0, signal: null, stdout: "", stderr: "", timedOut: false };
    };

    const results = await runV2TestFiles("agent", ["hung.test.ts", "ok.test.ts"], spawn, "v2", 1);

    expect(stderr).toHaveBeenCalledWith(spawnTimeoutMessage("agent", "hung.test.ts"));
    expect(calls).toEqual(["hung.test.ts", "ok.test.ts"]);
    expect(aggregateExitCode(results)).not.toBe(0);
  });

  test("non-agent mode stops the run on a timed-out file", async () => {
    spyOn(process.stderr, "write").mockImplementation(() => true);
    spyOn(process.stdout, "write").mockImplementation(() => true);
    const calls: string[] = [];
    const spawn = async (_cmd: string, args: string[]) => {
      const file = args[1] ?? "";
      calls.push(file);
      if (file === "hung.test.ts") {
        return { status: null, signal: "SIGKILL" as const, stdout: "", stderr: "", timedOut: true };
      }
      return { status: 0, signal: null, stdout: "", stderr: "", timedOut: false };
    };

    const results = await runV2TestFiles("integration", ["hung.test.ts", "ok.test.ts"], spawn, "v2", 1);

    expect(calls).toEqual(["hung.test.ts"]);
    expect(aggregateExitCode(results)).not.toBe(0);
  });

  test("an ordinary non-zero exit stops the run regardless of mode", async () => {
    spyOn(process.stderr, "write").mockImplementation(() => true);
    spyOn(process.stdout, "write").mockImplementation(() => true);
    const calls: string[] = [];
    const spawn = async (_cmd: string, args: string[]) => {
      const file = args[1] ?? "";
      calls.push(file);
      if (file === "failing.test.ts") {
        return { status: 1, signal: null, stdout: "", stderr: "", timedOut: false };
      }
      return { status: 0, signal: null, stdout: "", stderr: "", timedOut: false };
    };

    const results = await runV2TestFiles("agent", ["failing.test.ts", "ok.test.ts"], spawn, "v2", 1);

    expect(calls).toEqual(["failing.test.ts"]);
    expect(aggregateExitCode(results)).toBe(1);
  });

  test("flushes a settled file's captured output as one block headed by its file name", async () => {
    const stdout = spyOn(process.stdout, "write").mockImplementation(() => true);
    spyOn(process.stderr, "write").mockImplementation(() => true);
    const spawn = async () => ({
      status: 0,
      signal: null,
      stdout: "line one\n",
      stderr: "line two\n",
      timedOut: false,
    });

    await runV2TestFiles("agent", ["ok.test.ts"], spawn, "v2", 1);

    expect(stdout).toHaveBeenCalledWith(`${fileOutputHeader("ok.test.ts")}line one\nline two\n`);
  });

  test("emits a timed-out file's output captured before the kill instead of dropping it", async () => {
    const stdout = spyOn(process.stdout, "write").mockImplementation(() => true);
    spyOn(process.stderr, "write").mockImplementation(() => true);
    const spawn = async () => ({
      status: null,
      signal: "SIGKILL" as const,
      stdout: "partial output before kill\n",
      stderr: "",
      timedOut: true,
    });

    await runV2TestFiles("agent", ["hung.test.ts"], spawn, "v2", 1);

    expect(stdout).toHaveBeenCalledWith(`${fileOutputHeader("hung.test.ts")}partial output before kill\n`);
  });

  test("classifies a non-timeout SIGKILL as an ordinary failure, not a timeout", async () => {
    const stderr = spyOn(process.stderr, "write").mockImplementation(() => true);
    spyOn(process.stdout, "write").mockImplementation(() => true);
    const spawn = async () => ({
      status: null,
      signal: "SIGKILL" as const,
      stdout: "",
      stderr: "",
      timedOut: false,
    });

    const results = await runV2TestFiles("agent", ["killed.test.ts", "ok.test.ts"], spawn, "v2", 1);

    expect(stderr).not.toHaveBeenCalledWith(spawnTimeoutMessage("agent", "killed.test.ts"));
    expect(results).toEqual([{ file: "killed.test.ts", timedOut: false, status: null }]);
  });

  test("overlaps files up to the concurrency limit and no further", async () => {
    spyOn(process.stdout, "write").mockImplementation(() => true);
    spyOn(process.stderr, "write").mockImplementation(() => true);
    let inFlight = 0;
    let maxInFlight = 0;
    const spawn = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 15));
      inFlight -= 1;
      return { status: 0, signal: null, stdout: "", stderr: "", timedOut: false };
    };
    const files = ["a.test.ts", "b.test.ts", "c.test.ts", "d.test.ts", "e.test.ts", "f.test.ts"];

    await runV2TestFiles("agent", files, spawn, "v2", 3);

    expect(maxInFlight).toBe(3);
  });

  test("a non-finite concurrency never yields a zero-worker pool that reports success without running files", async () => {
    spyOn(process.stdout, "write").mockImplementation(() => true);
    spyOn(process.stderr, "write").mockImplementation(() => true);
    const spawn = async () => ({ status: 0, signal: null, stdout: "", stderr: "", timedOut: false });

    const results = await runV2TestFiles("agent", ["a.test.ts", "b.test.ts"], spawn, "v2", Number.NaN);

    expect(results.map((r) => r.file).sort()).toEqual(["a.test.ts", "b.test.ts"]);
  });

  test("a spawn error is reported as a failure for that file, and other pooled files still complete", async () => {
    spyOn(process.stdout, "write").mockImplementation(() => true);
    spyOn(process.stderr, "write").mockImplementation(() => true);
    const spawn = async (_cmd: string, args: string[]) => {
      const file = args[1] ?? "";
      if (file === "enoent.test.ts") {
        return {
          status: 1,
          signal: null,
          stdout: "",
          stderr: 'error: failed to spawn "bun": Error: spawn ENOENT\n',
          timedOut: false,
        };
      }
      return { status: 0, signal: null, stdout: "", stderr: "", timedOut: false };
    };

    const results = await runV2TestFiles("agent", ["enoent.test.ts", "ok.test.ts"], spawn, "v2", 2);

    expect(results.find((r) => r.file === "enoent.test.ts")).toEqual({
      file: "enoent.test.ts",
      timedOut: false,
      status: 1,
    });
  });

  test("a concurrency limit of 1 reproduces serial execution and roster-order settlement", async () => {
    spyOn(process.stdout, "write").mockImplementation(() => true);
    spyOn(process.stderr, "write").mockImplementation(() => true);
    let inFlight = 0;
    let maxInFlight = 0;
    const files = ["a.test.ts", "b.test.ts", "c.test.ts"];
    const spawn = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { status: 0, signal: null, stdout: "", stderr: "", timedOut: false };
    };

    const results = await runV2TestFiles("agent", files, spawn, "v2", 1);

    expect(maxInFlight).toBe(1);
    expect(results.map((r) => r.file)).toEqual(files);
  });

  test("arms each pooled child with the full per-file timeout independent of sibling runtime", async () => {
    spyOn(process.stdout, "write").mockImplementation(() => true);
    spyOn(process.stderr, "write").mockImplementation(() => true);
    const timeouts: number[] = [];
    const spawn = async (_cmd: string, args: string[], options: { timeout: number }) => {
      timeouts.push(options.timeout);
      if (args[1] === "slow.test.ts") {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return { status: 0, signal: null, stdout: "", stderr: "", timedOut: false };
    };

    await runV2TestFiles("agent", ["slow.test.ts", "fast.test.ts"], spawn, "v2", 2);

    expect(timeouts).toEqual([SUPPORTED_HEALTHY_FILE_BUDGET_MS, SUPPORTED_HEALTHY_FILE_BUDGET_MS]);
  });

  test("a timed-out file is killed and reported by name while pooled co-runners keep running to completion", async () => {
    const stderr = spyOn(process.stderr, "write").mockImplementation(() => true);
    spyOn(process.stdout, "write").mockImplementation(() => true);
    const files = ["hung.test.ts", "ok-1.test.ts", "ok-2.test.ts"];
    const spawn = async (_cmd: string, args: string[]) => {
      const file = args[1] ?? "";
      if (file === "hung.test.ts") {
        return { status: null, signal: "SIGKILL" as const, stdout: "", stderr: "", timedOut: true };
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { status: 0, signal: null, stdout: "", stderr: "", timedOut: false };
    };

    const results = await runV2TestFiles("agent", files, spawn, "v2", 3);

    expect(stderr).toHaveBeenCalledWith(spawnTimeoutMessage("agent", "hung.test.ts"));
    expect(results.map((r) => r.file).sort()).toEqual([...files].sort());
    expect(results.find((r) => r.file === "hung.test.ts")?.timedOut).toBe(true);
  });

  test("agent mode reports every timed-out file across concurrent workers and keeps admitting", async () => {
    spyOn(process.stderr, "write").mockImplementation(() => true);
    spyOn(process.stdout, "write").mockImplementation(() => true);
    const files = ["hung-1.test.ts", "hung-2.test.ts", "ok.test.ts"];
    const spawn = async (_cmd: string, args: string[]) => {
      const file = args[1] ?? "";
      if (file.startsWith("hung")) {
        return { status: null, signal: "SIGKILL" as const, stdout: "", stderr: "", timedOut: true };
      }
      return { status: 0, signal: null, stdout: "", stderr: "", timedOut: false };
    };

    const results = await runV2TestFiles("agent", files, spawn, "v2", 2);

    expect(results.map((r) => r.file).sort()).toEqual([...files].sort());
    expect(
      results
        .filter((r) => r.timedOut)
        .map((r) => r.file)
        .sort(),
    ).toEqual(["hung-1.test.ts", "hung-2.test.ts"]);
  });

  test("in-flight pooled files complete and report even after a sibling failure stops admission", async () => {
    spyOn(process.stderr, "write").mockImplementation(() => true);
    spyOn(process.stdout, "write").mockImplementation(() => true);
    const files = ["failing.test.ts", "slow-ok.test.ts", "never.test.ts"];
    const spawn = async (_cmd: string, args: string[]) => {
      const file = args[1] ?? "";
      if (file === "failing.test.ts") {
        return { status: 1, signal: null, stdout: "", stderr: "", timedOut: false };
      }
      if (file === "slow-ok.test.ts") {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return { status: 0, signal: null, stdout: "", stderr: "", timedOut: false };
      }
      return { status: 0, signal: null, stdout: "", stderr: "", timedOut: false };
    };

    const results = await runV2TestFiles("agent", files, spawn, "v2", 2);

    expect(results.map((r) => r.file).sort()).toEqual(["failing.test.ts", "slow-ok.test.ts"]);
  });
});

describe("load-sensitive isolation", () => {
  afterEach(() => {
    // biome-ignore lint/suspicious/noExplicitAny: bun:test mock restore is untyped
    (process.stderr.write as any).mockRestore?.();
    // biome-ignore lint/suspicious/noExplicitAny: bun:test mock restore is untyped
    (process.stdout.write as any).mockRestore?.();
  });

  test("isolated files observe exactly one concurrent runner for their whole window while pooled files overlap up to the limit", async () => {
    spyOn(process.stdout, "write").mockImplementation(() => true);
    spyOn(process.stderr, "write").mockImplementation(() => true);
    let inFlight = 0;
    let maxDuringIsolated = 0;
    let maxDuringPool = 0;
    const files = ["a.test.ts", "b.test.ts", "c.test.ts", "d.test.ts", "iso.sandbox-unrunnable.test.ts"];
    const spawn = async (_cmd: string, args: string[]) => {
      const file = args[1] ?? "";
      inFlight += 1;
      if (file.endsWith(".sandbox-unrunnable.test.ts")) {
        maxDuringIsolated = Math.max(maxDuringIsolated, inFlight);
      } else {
        maxDuringPool = Math.max(maxDuringPool, inFlight);
      }
      await new Promise((resolve) => setTimeout(resolve, 15));
      inFlight -= 1;
      return { status: 0, signal: null, stdout: "", stderr: "", timedOut: false };
    };

    const results = await runV2TestFiles("agent", files, spawn, "v2", 3);

    expect(maxDuringIsolated).toBe(1);
    expect(maxDuringPool).toBe(3);
    expect(results.map((r) => r.file).sort()).toEqual([...files].sort());
  });

  test("no isolated file starts while a pooled file is in flight", async () => {
    spyOn(process.stdout, "write").mockImplementation(() => true);
    spyOn(process.stderr, "write").mockImplementation(() => true);
    let poolInFlight = 0;
    let isolatedStartedWhilePoolInFlight = false;
    const files = ["a.test.ts", "b.test.ts", "iso.sandbox-unrunnable.test.ts"];
    const spawn = async (_cmd: string, args: string[]) => {
      const file = args[1] ?? "";
      if (file.endsWith(".sandbox-unrunnable.test.ts")) {
        if (poolInFlight > 0) {
          isolatedStartedWhilePoolInFlight = true;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { status: 0, signal: null, stdout: "", stderr: "", timedOut: false };
      }
      poolInFlight += 1;
      await new Promise((resolve) => setTimeout(resolve, 15));
      poolInFlight -= 1;
      return { status: 0, signal: null, stdout: "", stderr: "", timedOut: false };
    };

    await runV2TestFiles("agent", files, spawn, "v2", 2);

    expect(isolatedStartedWhilePoolInFlight).toBe(false);
  });

  test("agent mode continues past a timed-out isolated file and keeps running later isolated files", async () => {
    const stderr = spyOn(process.stderr, "write").mockImplementation(() => true);
    spyOn(process.stdout, "write").mockImplementation(() => true);
    const files = ["hung.sandbox-unrunnable.test.ts", "ok.sandbox-unrunnable.test.ts"];
    const spawn = async (_cmd: string, args: string[]) => {
      const file = args[1] ?? "";
      if (file === "hung.sandbox-unrunnable.test.ts") {
        return { status: null, signal: "SIGKILL" as const, stdout: "", stderr: "", timedOut: true };
      }
      return { status: 0, signal: null, stdout: "", stderr: "", timedOut: false };
    };

    const results = await runV2TestFiles("agent", files, spawn, "v2", 1);

    expect(stderr).toHaveBeenCalledWith(spawnTimeoutMessage("agent", "hung.sandbox-unrunnable.test.ts"));
    expect(results.map((r) => r.file).sort()).toEqual([...files].sort());
  });

  test("non-agent mode stops after an isolated file times out and never runs the next isolated file", async () => {
    spyOn(process.stderr, "write").mockImplementation(() => true);
    spyOn(process.stdout, "write").mockImplementation(() => true);
    const calls: string[] = [];
    const files = ["hung.sandbox-unrunnable.test.ts", "ok.sandbox-unrunnable.test.ts"];
    const spawn = async (_cmd: string, args: string[]) => {
      const file = args[1] ?? "";
      calls.push(file);
      if (file === "hung.sandbox-unrunnable.test.ts") {
        return { status: null, signal: "SIGKILL" as const, stdout: "", stderr: "", timedOut: true };
      }
      return { status: 0, signal: null, stdout: "", stderr: "", timedOut: false };
    };

    const results = await runV2TestFiles("integration", files, spawn, "v2", 1);

    expect(calls).toEqual(["hung.sandbox-unrunnable.test.ts"]);
    expect(results).toEqual([{ file: "hung.sandbox-unrunnable.test.ts", timedOut: true, status: null }]);
  });

  test("a plain failure in an isolated file stops every mode from admitting further isolated files, and is reported by name", async () => {
    spyOn(process.stderr, "write").mockImplementation(() => true);
    spyOn(process.stdout, "write").mockImplementation(() => true);
    const calls: string[] = [];
    const files = ["failing.sandbox-unrunnable.test.ts", "ok.sandbox-unrunnable.test.ts"];
    const spawn = async (_cmd: string, args: string[]) => {
      const file = args[1] ?? "";
      calls.push(file);
      if (file === "failing.sandbox-unrunnable.test.ts") {
        return { status: 1, signal: null, stdout: "", stderr: "", timedOut: false };
      }
      return { status: 0, signal: null, stdout: "", stderr: "", timedOut: false };
    };

    const results = await runV2TestFiles("agent", files, spawn, "v2", 1);

    expect(calls).toEqual(["failing.sandbox-unrunnable.test.ts"]);
    expect(results.find((r) => r.file === "failing.sandbox-unrunnable.test.ts")?.status).toBe(1);
  });
});

describe("aggregateExitCode", () => {
  test("is non-zero when any result failed or timed out regardless of settle order", () => {
    const results = [
      { file: "a.test.ts", timedOut: false, status: 1 },
      { file: "b.test.ts", timedOut: false, status: 0 },
    ];

    expect(aggregateExitCode(results)).not.toBe(0);
  });

  test("is zero when every result is a clean pass", () => {
    const results = [
      { file: "a.test.ts", timedOut: false, status: 0 },
      { file: "b.test.ts", timedOut: false, status: 0 },
    ];

    expect(aggregateExitCode(results)).toBe(0);
  });
});

describe("validatePerFileTimeout", () => {
  test.each([
    { name: "below the supported healthy file budget", timeout: SUPPORTED_HEALTHY_FILE_BUDGET_MS - 1, throws: true },
    { name: "equal to the supported healthy file budget", timeout: SUPPORTED_HEALTHY_FILE_BUDGET_MS, throws: false },
    { name: "above the supported healthy file budget", timeout: SUPPORTED_HEALTHY_FILE_BUDGET_MS + 1, throws: false },
  ])("$name", ({ timeout, throws }) => {
    const call = () => validatePerFileTimeout(timeout);
    if (throws) {
      expect(call).toThrow();
    } else {
      expect(call).not.toThrow();
    }
  });
});
