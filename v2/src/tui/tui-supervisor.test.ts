import { describe, expect, test } from "bun:test";
import { TUI_REEXEC_CHANNEL_ENV, TUI_REVISION_REEXEC_EXIT_CODE } from "./tui-reexec-channel.ts";
import { buildTuiReexecEnv, performTuiRevisionReexec, TUI_REEXEC_REVISION_ENV } from "./tui-revision-reexec.ts";
import {
  createInMemoryTuiRevisionReexecChannel,
  runTuiSupervisor,
  TUI_SUPERVISOR_WORKER_ENV,
  tuiSupervisorWorkerExitCode,
} from "./tui-supervisor.ts";

describe("tuiSupervisorWorkerExitCode", () => {
  test("passes through a numeric exit code", () => {
    expect(tuiSupervisorWorkerExitCode(2)).toBe(2);
  });

  test("defaults a null (signal-terminated) code to 0", () => {
    expect(tuiSupervisorWorkerExitCode(null)).toBe(0);
  });
});

describe("runTuiSupervisor", () => {
  test("respawns three times on reserved exit then ends with the worker code", async () => {
    const channel = createInMemoryTuiRevisionReexecChannel();
    const supervisorBaseEnv = { PATH: "/bin" };
    const spawnEnvs: NodeJS.ProcessEnv[] = [];
    let spawnCount = 0;

    const code = await runTuiSupervisor({
      argv: ["/usr/bin/node", "/path/cli.js", "tui"],
      supervisorBaseEnv,
      channel,
      channelFilePath: "/tmp/channel",
      spawnWorker: async (env) => {
        spawnCount += 1;
        spawnEnvs.push({ ...env });
        if (spawnCount <= 3) {
          channel.publish({
            daemonRevision: `rev-${spawnCount}`,
            carriedState: {
              selectedNodeId: `run-${spawnCount}`,
              expandedPipelineNodeIds: [`pipe-${spawnCount}`],
            },
          });
          return TUI_REVISION_REEXEC_EXIT_CODE;
        }
        return 0;
      },
    });

    expect(code).toBe(0);
    expect(spawnCount).toBe(4);
    expect(spawnEnvs[0]?.[TUI_SUPERVISOR_WORKER_ENV]).toBe("1");
    expect(spawnEnvs[0]?.[TUI_REEXEC_CHANNEL_ENV]).toBe("/tmp/channel");
    expect(spawnEnvs[0]?.[TUI_REEXEC_REVISION_ENV]).toBeUndefined();

    const expectedSecond = buildTuiReexecEnv(supervisorBaseEnv, "rev-1", {
      selectedNodeId: "run-1",
      expandedPipelineNodeIds: ["pipe-1"],
    });
    expect(spawnEnvs[1]).toEqual({
      ...expectedSecond,
      [TUI_SUPERVISOR_WORKER_ENV]: "1",
      [TUI_REEXEC_CHANNEL_ENV]: "/tmp/channel",
    });
  });

  test("ends with a non-reserved worker exit code", async () => {
    const code = await runTuiSupervisor({
      argv: ["/usr/bin/node", "tui"],
      supervisorBaseEnv: {},
      channel: createInMemoryTuiRevisionReexecChannel(),
      channelFilePath: "/tmp/channel",
      spawnWorker: async () => 9,
    });
    expect(code).toBe(9);
  });

  test("ends with 1 when the worker exits reserved without a channel record", async () => {
    const code = await runTuiSupervisor({
      argv: ["/usr/bin/node", "tui"],
      supervisorBaseEnv: {},
      channel: createInMemoryTuiRevisionReexecChannel(),
      channelFilePath: "/tmp/channel",
      spawnWorker: async () => TUI_REVISION_REEXEC_EXIT_CODE,
    });
    expect(code).toBe(1);
  });

  test("respawns log-follow workers on reserved exit without nesting another supervisor child", async () => {
    const logArgv = ["/usr/bin/node", "/path/cli.js", "tui", "log", "run-abc"];
    const channel = createInMemoryTuiRevisionReexecChannel();
    let spawnCount = 0;

    const code = await runTuiSupervisor({
      argv: logArgv,
      supervisorBaseEnv: { PATH: "/bin" },
      channel,
      channelFilePath: "/tmp/channel",
      spawnWorker: async () => {
        spawnCount += 1;
        if (spawnCount === 1) {
          let exitCode: number | undefined;
          await performTuiRevisionReexec({
            daemonRevision: "rev-b",
            carriedState: { selectedNodeId: null, expandedPipelineNodeIds: [] },
            argv: logArgv,
            channel,
            teardown: {
              closeMonitor: () => {},
              closeRefreshScheduler: () => {},
              closeDaemonClient: () => {},
            },
            exitProcess: (code) => {
              exitCode = code;
            },
          });
          return exitCode ?? TUI_REVISION_REEXEC_EXIT_CODE;
        }
        return 0;
      },
    });

    expect(code).toBe(0);
    expect(spawnCount).toBe(2);
  });

  test("in-process monitor log revision re-exec respawns with tui log run-id argv", async () => {
    const monitorArgv = ["/usr/bin/node", "/path/cli.js", "tui"];
    const logReexecArgv = ["/usr/bin/node", "/path/cli.js", "tui", "log", "run-456"];
    const channel = createInMemoryTuiRevisionReexecChannel();
    const spawnedArgvs: (readonly string[])[] = [];
    let spawnCount = 0;

    const code = await runTuiSupervisor({
      argv: monitorArgv,
      supervisorBaseEnv: { PATH: "/bin" },
      channel,
      channelFilePath: "/tmp/channel",
      spawnWorker: async (_env, workerArgv) => {
        spawnCount += 1;
        spawnedArgvs.push(workerArgv);
        if (spawnCount === 1) {
          let exitCode: number | undefined;
          await performTuiRevisionReexec({
            daemonRevision: "rev-b",
            carriedState: { selectedNodeId: null, expandedPipelineNodeIds: [] },
            argv: logReexecArgv,
            channel,
            teardown: {
              closeMonitor: () => {},
              closeRefreshScheduler: () => {},
              closeDaemonClient: () => {},
            },
            exitProcess: (code) => {
              exitCode = code;
            },
          });
          return exitCode ?? TUI_REVISION_REEXEC_EXIT_CODE;
        }
        return 0;
      },
    });

    expect(code).toBe(0);
    expect(spawnCount).toBe(2);
    expect(spawnedArgvs[0]).toEqual(monitorArgv);
    expect(spawnedArgvs[1]).toEqual(logReexecArgv);
  });
});
