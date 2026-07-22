import { describe, expect, test } from "bun:test";
import { DaemonAlreadyRunningError } from "../daemon/daemon-lifecycle.ts";
import type { IpcClient } from "../ipc/client.ts";
import type { CliDeps } from "./deps.ts";
import { connectWithAutoStart, stripAutoBounceFlag } from "./stale-dispatch.ts";

describe("stripAutoBounceFlag", () => {
  test("removes --no-auto-bounce flag and reports autoBounce=true when flag is absent", () => {
    const result = stripAutoBounceFlag(["run", "start"]);
    expect(result.argv).toEqual(["run", "start"]);
    expect(result.autoBounce).toBe(true);
  });

  test("removes --no-auto-bounce flag and reports autoBounce=false when flag is present", () => {
    const result = stripAutoBounceFlag(["run", "--no-auto-bounce", "start"]);
    expect(result.argv).toEqual(["run", "start"]);
    expect(result.autoBounce).toBe(false);
  });

  test("removes all --no-auto-bounce occurrences", () => {
    const result = stripAutoBounceFlag(["--no-auto-bounce", "run", "--no-auto-bounce", "start"]);
    expect(result.argv).toEqual(["run", "start"]);
    expect(result.autoBounce).toBe(false);
  });
});

describe("connectWithAutoStart", () => {
  function createMockIpc(): IpcClient {
    return {
      send: () => {},
      nextFrame: async () => ({ kind: "response" as const, id: "0", result: {} }),
      close: () => {},
    };
  }

  /** The default clock advances so a never-connecting mock exhausts the deadline and fails the test
   * rather than hanging the suite. */
  function createPartialDeps(overrides?: Partial<CliDeps>): Partial<CliDeps> {
    let time = 0;
    return {
      connectIpcClient: async () => createMockIpc(),
      startDaemon: async () => ({ pid: 9999, socketPath: "" }),
      pidPath: "/tmp/test.pid",
      logPath: "/tmp/test.log",
      now: () => time,
      sleep: async (ms: number) => {
        time += ms;
      },
      ...overrides,
    };
  }

  test("connects successfully when daemon is already running", async () => {
    let connectCount = 0;
    let startCalled = false;

    const deps = createPartialDeps({
      connectIpcClient: async () => {
        connectCount += 1;
        return createMockIpc();
      },
      startDaemon: async () => {
        startCalled = true;
        return { pid: 1234, socketPath: "" };
      },
    }) as CliDeps;

    const client = await connectWithAutoStart(deps, "/tmp/test.sock");
    expect(connectCount).toBe(1);
    expect(startCalled).toBe(false);
    client.close();
  });

  test("starts daemon and connects on initial ECONNREFUSED", async () => {
    let connectCount = 0;
    let startCalled = false;

    const deps = createPartialDeps({
      connectIpcClient: async () => {
        connectCount += 1;
        if (connectCount === 1) {
          throw new Error("ECONNREFUSED");
        }
        return createMockIpc();
      },
      startDaemon: async (socketPath, options) => {
        startCalled = true;
        expect(options?.pidPath).toBe("/tmp/test.pid");
        expect(options?.logPath).toBe("/tmp/test.log");
        return { pid: 1234, socketPath };
      },
    }) as CliDeps;

    const client = await connectWithAutoStart(deps, "/tmp/test.sock");
    expect(connectCount).toBe(2);
    expect(startCalled).toBe(true);
    client.close();
  });

  test("handles DaemonAlreadyRunningError by retrying connect without second start", async () => {
    let startCount = 0;
    let connectAttempts = 0;

    const deps = createPartialDeps({
      connectIpcClient: async () => {
        connectAttempts += 1;
        if (connectAttempts <= 1) {
          throw new Error("ECONNREFUSED");
        }
        return createMockIpc();
      },
      startDaemon: async () => {
        startCount += 1;
        throw new DaemonAlreadyRunningError("/tmp/test.sock");
      },
    }) as CliDeps;

    const client = await connectWithAutoStart(deps, "/tmp/test.sock");
    expect(startCount).toBe(1);
    expect(connectAttempts).toBe(2);
    client.close();
  });

  test("re-throws non-race startDaemon errors unchanged", async () => {
    const deps = createPartialDeps({
      connectIpcClient: async () => {
        throw new Error("ECONNREFUSED");
      },
      startDaemon: async () => {
        throw new Error("Failed to spawn daemon process: pid is undefined");
      },
    }) as CliDeps;

    let threwError = false;
    try {
      await connectWithAutoStart(deps, "/tmp/test.sock");
    } catch (error) {
      threwError = true;
      expect(error instanceof Error).toBe(true);
      expect((error as Error).message).toContain("Failed to spawn daemon");
    }
    expect(threwError).toBe(true);
  });

  test("respects the connect deadline and reports the last connect error as cause", async () => {
    let time = 0;
    let connectAttempts = 0;
    const deps = createPartialDeps({
      connectIpcClient: async () => {
        connectAttempts += 1;
        throw new Error("ECONNREFUSED");
      },
      startDaemon: async () => {
        throw new DaemonAlreadyRunningError("/tmp/test.sock");
      },
      now: () => time,
      sleep: async (ms: number) => {
        time += ms;
      },
    }) as CliDeps;

    let thrown: unknown;
    try {
      await connectWithAutoStart(deps, "/tmp/test.sock");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("Failed to connect to daemon");
    expect((thrown as Error).cause).toBeInstanceOf(Error);
    expect(((thrown as Error).cause as Error).message).toBe("ECONNREFUSED");
    // Initial connect plus one retry per 50ms sleep across the 5000ms deadline.
    expect(connectAttempts).toBe(102);
    expect(time).toBe(5000);
  });

  test("uses injected now/sleep for deadline calculation, not real clock", async () => {
    let time = 0;
    const sleepCalls: number[] = [];
    let connectAttempts = 0;

    const deps = createPartialDeps({
      connectIpcClient: async () => {
        connectAttempts += 1;
        if (connectAttempts <= 3) {
          throw new Error("ECONNREFUSED");
        }
        return createMockIpc();
      },
      startDaemon: async () => {
        throw new DaemonAlreadyRunningError("/tmp/test.sock");
      },
      now: () => time,
      sleep: async (ms: number) => {
        sleepCalls.push(ms);
        time += ms;
      },
    }) as CliDeps;

    const client = await connectWithAutoStart(deps, "/tmp/test.sock");
    // One initial connect plus two failed retries, each separated by a fixed 50ms sleep.
    expect(sleepCalls).toEqual([50, 50]);
    expect(connectAttempts).toBe(4);
    client.close();
  });

  test("pins already-connected branch so startDaemon is never called", async () => {
    let startCalled = false;

    const deps = createPartialDeps({
      connectIpcClient: async () => createMockIpc(),
      startDaemon: async () => {
        startCalled = true;
        return { pid: 1234, socketPath: "" };
      },
    }) as CliDeps;

    const client = await connectWithAutoStart(deps, "/tmp/test.sock");
    expect(startCalled).toBe(false);
    client.close();
  });

  test("pins race branch so no second start is attempted after DaemonAlreadyRunningError", async () => {
    let startCount = 0;

    const deps = createPartialDeps({
      connectIpcClient: async () => {
        throw new Error("ECONNREFUSED");
      },
      startDaemon: async () => {
        startCount += 1;
        throw new DaemonAlreadyRunningError("/tmp/test.sock");
      },
    }) as CliDeps;

    await expect(connectWithAutoStart(deps, "/tmp/test.sock")).rejects.toThrow(
      "Failed to connect to daemon on socket /tmp/test.sock",
    );
    expect(startCount).toBe(1);
  });

  test("pins non-race error branch so connect retry does not happen", async () => {
    let connectCount = 0;
    let startCalled = false;

    const deps = createPartialDeps({
      connectIpcClient: async () => {
        connectCount += 1;
        throw new Error("ECONNREFUSED");
      },
      startDaemon: async () => {
        startCalled = true;
        throw new Error("Some other error");
      },
    }) as CliDeps;

    let threwError = false;
    try {
      await connectWithAutoStart(deps, "/tmp/test.sock");
    } catch {
      threwError = true;
    }
    expect(threwError).toBe(true);
    expect(connectCount).toBe(1);
    expect(startCalled).toBe(true);
  });

  test("successfully connects after winning the daemon-start race", async () => {
    let connectCount = 0;

    const deps = createPartialDeps({
      connectIpcClient: async () => {
        connectCount += 1;
        if (connectCount === 1) {
          throw new Error("ECONNREFUSED");
        }
        return createMockIpc();
      },
      startDaemon: async () => {
        return { pid: 1234, socketPath: "/tmp/test.sock" };
      },
    }) as CliDeps;

    const client = await connectWithAutoStart(deps, "/tmp/test.sock");
    expect(connectCount).toBe(2);
    client.close();
  });

  test("passes keyed socket/PID/log paths to startDaemon", async () => {
    const startCalls: { socketPath: string; options: Parameters<CliDeps["startDaemon"]>[1] }[] = [];
    let connectCount = 0;

    const deps = createPartialDeps({
      connectIpcClient: async () => {
        connectCount += 1;
        if (connectCount === 1) {
          throw new Error("ECONNREFUSED");
        }
        return createMockIpc();
      },
      startDaemon: async (socketPath, options) => {
        startCalls.push({ socketPath, options });
        return { pid: 1234, socketPath };
      },
      pidPath: "/my/pid.file",
      logPath: "/my/log.file",
    }) as CliDeps;

    const client = await connectWithAutoStart(deps, "/my/socket.sock");
    expect(startCalls).toHaveLength(1);
    const firstCall = startCalls[0];
    if (!firstCall) throw new Error("startCalls[0] is undefined");
    expect(firstCall.socketPath).toBe("/my/socket.sock");
    expect(firstCall.options?.pidPath).toBe("/my/pid.file");
    expect(firstCall.options?.logPath).toBe("/my/log.file");
    client.close();
  });
});
