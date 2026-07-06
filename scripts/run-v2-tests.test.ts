import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { aggregateExitCode, isSpawnTimeout, runV2TestFiles, spawnTimeoutMessage } from "./run-v2-tests.ts";

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

describe("runV2TestFiles", () => {
  afterEach(() => {
    // biome-ignore lint/suspicious/noExplicitAny: bun:test mock restore is untyped
    (process.stderr.write as any).mockRestore?.();
  });

  test("agent mode continues past a timed-out file and still runs the rest", () => {
    const stderr = spyOn(process.stderr, "write").mockImplementation(() => true);
    const calls: string[] = [];
    const spawn = (_cmd: string, args: string[]) => {
      const file = args[1] ?? "";
      calls.push(file);
      if (file === "hung.test.ts") {
        return { status: null, signal: "SIGKILL" as const };
      }
      return { status: 0, signal: null };
    };

    const results = runV2TestFiles("agent", ["hung.test.ts", "ok.test.ts"], spawn);

    expect(stderr).toHaveBeenCalledWith(spawnTimeoutMessage("agent", "hung.test.ts"));
    expect(calls).toEqual(["hung.test.ts", "ok.test.ts"]);
    expect(aggregateExitCode(results)).not.toBe(0);
  });

  test("non-agent mode stops the run on a timed-out file", () => {
    spyOn(process.stderr, "write").mockImplementation(() => true);
    const calls: string[] = [];
    const spawn = (_cmd: string, args: string[]) => {
      const file = args[1] ?? "";
      calls.push(file);
      if (file === "hung.test.ts") {
        return { status: null, signal: "SIGKILL" as const };
      }
      return { status: 0, signal: null };
    };

    const results = runV2TestFiles("integration", ["hung.test.ts", "ok.test.ts"], spawn);

    expect(calls).toEqual(["hung.test.ts"]);
    expect(aggregateExitCode(results)).not.toBe(0);
  });

  test("an ordinary non-zero exit stops the run regardless of mode", () => {
    spyOn(process.stderr, "write").mockImplementation(() => true);
    const calls: string[] = [];
    const spawn = (_cmd: string, args: string[]) => {
      const file = args[1] ?? "";
      calls.push(file);
      if (file === "failing.test.ts") {
        return { status: 1, signal: null };
      }
      return { status: 0, signal: null };
    };

    const results = runV2TestFiles("agent", ["failing.test.ts", "ok.test.ts"], spawn);

    expect(calls).toEqual(["failing.test.ts"]);
    expect(aggregateExitCode(results)).toBe(1);
  });
});
