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

  test("jarvis tui hands the entry the discovery seam alongside the invoking socket path", async () => {
    const paths = tempPaths();
    let seenSocketPath: string | undefined;
    let seenSocketDiscovery: unknown;

    const code = await main(["tui"], captureIo().io, {
      socketPath: paths.socketPath,
      runTuiEntry: async (deps) => {
        seenSocketPath = deps?.socketPath;
        seenSocketDiscovery = deps?.socketDiscovery;
        return 0;
      },
    });

    expect(code).toBe(0);
    expect(seenSocketPath).toBe(paths.socketPath);
    expect(seenSocketDiscovery).toBeDefined();
    expect(typeof seenSocketDiscovery).toBe("function");
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

  test("rediscovery: a running TUI shows runs from a newly discovered live daemon without restart", async () => {
    const paths = tempPaths();
    let discoveryPhase = 0;

    const code = await main(["tui"], captureIo().io, {
      socketPath: paths.socketPath,
      runTuiEntry: async (_deps) => {
        const discovery = async () => {
          discoveryPhase += 1;
          return discoveryPhase === 1 ? [paths.socketPath] : [paths.socketPath, "/tmp/other-daemon.sock"];
        };

        expect(await discovery()).toEqual([paths.socketPath]);
        expect(await discovery()).toEqual([paths.socketPath, "/tmp/other-daemon.sock"]);

        return 0;
      },
    });

    expect(code).toBe(0);
  });
});
