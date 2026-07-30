import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { READY_STEP_COMPLETION_MARKER, type ReadyStepCompletion, readyAttemptEnvironment, runReady } from "./ready.ts";
import { FAILING_TEST_FILE_MARKER, failingTestFileRecord, READY_ATTEMPT_ENV } from "./run-v2-tests.ts";

const inheritedTier = process.env.JARVIS_READY_TIER;
const inheritedScope = process.env.JARVIS_READY_TEST_SCOPE;

afterEach(() => {
  if (inheritedTier === undefined) {
    delete process.env.JARVIS_READY_TIER;
  } else {
    process.env.JARVIS_READY_TIER = inheritedTier;
  }
  if (inheritedScope === undefined) {
    delete process.env.JARVIS_READY_TEST_SCOPE;
  } else {
    process.env.JARVIS_READY_TEST_SCOPE = inheritedScope;
  }
  // biome-ignore lint/suspicious/noExplicitAny: bun:test mock restore is untyped
  (process.stderr.write as any).mockRestore?.();
});

function selectRecords<T>(writes: string[], marker: string): T[] {
  return writes.filter((line) => line.startsWith(marker)).map((line) => JSON.parse(line.slice(marker.length)) as T);
}

function startFastReady(runCommandFn: NonNullable<Parameters<typeof runReady>[0]>["runCommandFn"]): Promise<void> {
  process.env.JARVIS_READY_TIER = "fast";
  process.env.JARVIS_READY_TEST_SCOPE = "test:v2";
  const pending = runReady({ runCommandFn });
  if (inheritedTier === undefined) {
    delete process.env.JARVIS_READY_TIER;
  } else {
    process.env.JARVIS_READY_TIER = inheritedTier;
  }
  if (inheritedScope === undefined) {
    delete process.env.JARVIS_READY_TEST_SCOPE;
  } else {
    process.env.JARVIS_READY_TEST_SCOPE = inheritedScope;
  }
  return pending;
}

describe("ready step completion evidence", () => {
  test("forwards the ready attempt identity through the child environment", () => {
    expect(readyAttemptEnvironment("2.1", { INHERITED: "yes" })).toEqual({
      INHERITED: "yes",
      [READY_ATTEMPT_ENV]: "2.1",
    });
  });

  test("a failed test retry has a distinct final attempt correlated to its own file records", async () => {
    const writes: string[] = [];
    spyOn(process.stderr, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    const originalExit = process.exit;
    process.exit = ((code: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never;

    try {
      await expect(
        startFastReady(async (_name, args, _armedMs, _bound, attemptId) => {
          if (args[1] !== "test:v2") {
            return 0;
          }
          process.stderr.write(failingTestFileRecord(`v2/${attemptId}.test.ts`, attemptId ?? ""));
          return 1;
        }),
      ).rejects.toThrow("process.exit(1)");
    } finally {
      process.exit = originalExit;
    }

    const completions = selectRecords<ReadyStepCompletion>(writes, READY_STEP_COMPLETION_MARKER);
    const testCompletions = completions.filter((record) => record.command === "bun run test:v2");
    expect(testCompletions.map(({ attemptId, status }) => ({ attemptId, status }))).toEqual([
      { attemptId: "2.1", status: 1 },
      { attemptId: "2.2", status: 1 },
    ]);
    const terminal = completions.at(-1);
    const files = selectRecords<{ attemptId: string; path: string }>(writes, FAILING_TEST_FILE_MARKER);
    expect(files.filter((record) => record.attemptId === terminal?.attemptId)).toEqual([
      { attemptId: "2.2", path: "v2/2.2.test.ts" },
    ]);
  });

  test("a recovered retry ends on its passing attempt and contributes no terminal failure", async () => {
    const writes: string[] = [];
    spyOn(process.stderr, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    let testAttempts = 0;

    await startFastReady(async (_name, args, _armedMs, _bound, attemptId) => {
      if (args[1] !== "test:v2") {
        return 0;
      }
      testAttempts += 1;
      if (testAttempts === 1) {
        process.stderr.write(failingTestFileRecord("v2/flaky.test.ts", attemptId ?? ""));
        return 1;
      }
      return 0;
    });

    const completions = selectRecords<ReadyStepCompletion>(writes, READY_STEP_COMPLETION_MARKER);
    expect(completions.filter((record) => record.command === "bun run test:v2")).toEqual([
      { stepId: "2", attemptId: "2.1", command: "bun run test:v2", status: 1 },
      { stepId: "2", attemptId: "2.2", command: "bun run test:v2", status: 0 },
    ]);
    expect(completions.at(-1)?.status).toBe(0);
  });

  test("a later non-test failure is the terminal boundary after recovered test records", async () => {
    const writes: string[] = [];
    spyOn(process.stderr, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    const originalExit = process.exit;
    process.exit = ((code: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never;
    process.env.JARVIS_READY_TIER = "full";
    process.env.JARVIS_READY_TEST_SCOPE = "test:v2";
    let testAttempts = 0;

    try {
      const pending = runReady({
        runCommandFn: async (_name, args, _armedMs, _bound, attemptId) => {
          if (args[1] === "test:v2") {
            testAttempts += 1;
            if (testAttempts === 1) {
              process.stderr.write(failingTestFileRecord("v2/flaky.test.ts", attemptId ?? ""));
              return 1;
            }
          }
          return args[1] === "lint:md" ? 3 : 0;
        },
      });
      delete process.env.JARVIS_READY_TIER;
      delete process.env.JARVIS_READY_TEST_SCOPE;
      await expect(pending).rejects.toThrow("process.exit(3)");
    } finally {
      process.exit = originalExit;
    }

    const completions = selectRecords<ReadyStepCompletion>(writes, READY_STEP_COMPLETION_MARKER);
    const terminal = completions.at(-1);
    expect(terminal).toMatchObject({ command: "bun run lint:md", status: 3 });
    const files = selectRecords<{ attemptId: string; path: string }>(writes, FAILING_TEST_FILE_MARKER);
    expect(files.some((record) => record.attemptId === terminal?.attemptId)).toBe(false);
  });
});
