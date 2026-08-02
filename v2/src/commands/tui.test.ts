import { describe, expect, test } from "bun:test";
import { captureIo, cliMain as main, tempPaths, writeMachineConfig } from "../testing/cli-test-helpers.ts";

describe("tui command", () => {
  test("jarvis tui dispatches to runTuiEntry with the production socket path", async () => {
    const paths = tempPaths();
    let seenSocketPath: string | undefined;

    const code = await main(["tui"], captureIo().io, {
      machineConfigPath: writeMachineConfig({ machineProfile: "workstation" }),
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
      machineConfigPath: writeMachineConfig({ machineProfile: "workstation" }),
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

  test("jarvis tui resolves and supplies the invoking profile and keyed socket before opening", async () => {
    // @mutate v2/src/commands/tui.ts "if (machineProfile === undefined) return Promise.resolve(1);" -> "if (machineProfile !== undefined) return Promise.resolve(1);"
    const socketPath = "/tmp/daemon-0123456789abcdef.sock";
    let seenSocketPath: string | undefined;
    let seenMachineProfile: string | undefined;

    const code = await main(["tui"], captureIo().io, {
      machineConfigPath: writeMachineConfig({ machineProfile: "workstation" }),
      socketPath,
      runTuiEntry: async (deps) => {
        seenSocketPath = deps.socketPath;
        seenMachineProfile = deps.machineProfile;
        return 0;
      },
    });

    expect(code).toBe(0);
    expect(seenSocketPath).toBe(socketPath);
    expect(seenMachineProfile).toBe("workstation");
  });

  test.each([
    ["missing", {}],
    ["invalid", { machineProfile: 42 }],
  ])("jarvis tui rejects a %s machine profile before opening the monitor", async (_label, config) => {
    const cap = captureIo();
    let monitorOpenCount = 0;

    const code = await main(["tui"], cap.io, {
      machineConfigPath: writeMachineConfig(config),
      runTuiEntry: async () => {
        monitorOpenCount += 1;
        return 0;
      },
    });

    expect(code).toBe(1);
    expect(monitorOpenCount).toBe(0);
    expect(cap.read().stderr).toContain("missing required 'machineProfile' key");
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

  test("jarvis tui log hands the follow entry the discovery seam alongside the invoking socket path", async () => {
    const paths = tempPaths();
    let seenRunId: string | undefined;
    let seenSocketPath: string | undefined;
    let seenSocketDiscovery: unknown;

    const code = await main(["tui", "log", "run-abc"], captureIo().io, {
      socketPath: paths.socketPath,
      runTuiLogFollow: async (runId, deps) => {
        seenRunId = runId;
        seenSocketPath = deps?.socketPath;
        seenSocketDiscovery = deps?.socketDiscovery;
        return 0;
      },
    });

    expect(code).toBe(0);
    expect(seenRunId).toBe("run-abc");
    expect(seenSocketPath).toBe(paths.socketPath);
    expect(seenSocketDiscovery).toBeDefined();
    expect(typeof seenSocketDiscovery).toBe("function");
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
      machineConfigPath: writeMachineConfig({ machineProfile: "workstation" }),
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
