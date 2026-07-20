import { describe, expect, test } from "bun:test";
import { captureIo, cliMain as main, tempPaths } from "../testing/cli-test-helpers.ts";

describe("tui command", () => {
  test("jarvis tui dispatches to runTuiEntry with the production socket path", async () => {
    const paths = tempPaths();
    let seenSocketPath: string | undefined;

    const code = await main(["tui"], captureIo().io, {
      socketPath: paths.socketPath,
      runTuiEntry: async (deps) => {
        seenSocketPath = deps?.socketPath;
        return 0;
      },
    });

    expect(code).toBe(0);
    expect(seenSocketPath).toBe(paths.socketPath);
  });

  test("jarvis tui with extra args prints usage and exits 1", async () => {
    const cap = captureIo();

    const code = await main(["tui", "--foo"], cap.io, {
      runTuiEntry: async () => {
        throw new Error("should not run");
      },
    });

    expect(code).toBe(1);
    expect(cap.read().stderr).toContain("usage: jarvis tui");
  });

  test("jarvis tui log dispatches to runTuiLogFollow with run id and production socket path", async () => {
    const paths = tempPaths();
    let seenRunId: string | undefined;
    let seenSocketPath: string | undefined;

    const code = await main(["tui", "log", "run-abc"], captureIo().io, {
      socketPath: paths.socketPath,
      runTuiLogFollow: async (runId, deps) => {
        seenRunId = runId;
        seenSocketPath = deps?.socketPath;
        return 0;
      },
    });

    expect(code).toBe(0);
    expect(seenRunId).toBe("run-abc");
    expect(seenSocketPath).toBe(paths.socketPath);
  });

  test("jarvis tui log with missing or extra arguments prints usage and exits 1", async () => {
    const cap = captureIo();

    const missingRunId = await main(["tui", "log"], cap.io, {
      runTuiLogFollow: async () => {
        throw new Error("should not run");
      },
    });
    const extraArgs = await main(["tui", "log", "run-abc", "extra"], cap.io, {
      runTuiLogFollow: async () => {
        throw new Error("should not run");
      },
    });

    expect(missingRunId).toBe(1);
    expect(extraArgs).toBe(1);
    expect(cap.read().stderr).toContain("usage: jarvis tui log <run-id>");
  });
});
