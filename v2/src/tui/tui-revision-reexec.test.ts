import { describe, expect, test } from "bun:test";
import { TUI_REVISION_REEXEC_EXIT_CODE, type TuiRevisionReexecChannelPayload } from "./tui-reexec-channel.ts";
import {
  buildTuiReexecEnv,
  performTuiRevisionReexec,
  readTuiReexecCarriedState,
  readTuiReexecedForRevision,
  TUI_REEXEC_EXPANDED_PIPELINE_NODE_IDS_ENV,
  TUI_REEXEC_REVISION_ENV,
  TUI_REEXEC_SELECTED_NODE_ID_ENV,
} from "./tui-revision-reexec.ts";

describe("readTuiReexecedForRevision", () => {
  test("reads the marker when present", () => {
    expect(readTuiReexecedForRevision({ [TUI_REEXEC_REVISION_ENV]: "rev-b" })).toBe("rev-b");
  });

  test("is undefined when absent", () => {
    expect(readTuiReexecedForRevision({})).toBeUndefined();
  });
});

describe("readTuiReexecCarriedState", () => {
  test("restores selection and expanded ids when present", () => {
    const state = readTuiReexecCarriedState({
      [TUI_REEXEC_SELECTED_NODE_ID_ENV]: "run-alpha",
      [TUI_REEXEC_EXPANDED_PIPELINE_NODE_IDS_ENV]: "pipe-a,pipe-b",
    });
    expect(state).toEqual({ selectedNodeId: "run-alpha", expandedPipelineNodeIds: ["pipe-a", "pipe-b"] });
  });

  test("defaults to null selection and no expanded ids when absent", () => {
    // Mutation checkpoint: negating `expandedRaw !== undefined` must turn this RED (would split "" into [""]).
    expect(readTuiReexecCarriedState({})).toEqual({ selectedNodeId: null, expandedPipelineNodeIds: [] });
  });
});

describe("buildTuiReexecEnv", () => {
  test("always sets the revision marker", () => {
    const env = buildTuiReexecEnv({}, "rev-b", { selectedNodeId: null, expandedPipelineNodeIds: [] });
    expect(env[TUI_REEXEC_REVISION_ENV]).toBe("rev-b");
    expect(env[TUI_REEXEC_SELECTED_NODE_ID_ENV]).toBeUndefined();
    expect(env[TUI_REEXEC_EXPANDED_PIPELINE_NODE_IDS_ENV]).toBeUndefined();
  });

  test("carries a non-null selection", () => {
    const env = buildTuiReexecEnv({}, "rev-b", { selectedNodeId: "run-alpha", expandedPipelineNodeIds: [] });
    expect(env[TUI_REEXEC_SELECTED_NODE_ID_ENV]).toBe("run-alpha");
  });

  test("carries non-empty expanded ids", () => {
    const env = buildTuiReexecEnv({}, "rev-b", { selectedNodeId: null, expandedPipelineNodeIds: ["pipe-a"] });
    expect(env[TUI_REEXEC_EXPANDED_PIPELINE_NODE_IDS_ENV]).toBe("pipe-a");
  });

  test("preserves the base environment", () => {
    const env = buildTuiReexecEnv({ PATH: "/bin" }, "rev-b", { selectedNodeId: null, expandedPipelineNodeIds: [] });
    expect(env.PATH).toBe("/bin");
  });
});

describe("performTuiRevisionReexec", () => {
  test("refuses to re-exec when process.argv is empty, after tearing down", async () => {
    const originalArgv = process.argv;
    const closed: string[] = [];
    process.argv = [];
    try {
      // Mutation checkpoint: negating `executable === undefined` would skip this throw and
      // instead attempt to spawn `undefined` as the command, rejecting with a different message.
      await expect(
        performTuiRevisionReexec({
          daemonRevision: "rev-b",
          carriedState: { selectedNodeId: null, expandedPipelineNodeIds: [] },
          teardown: {
            closeMonitor: () => closed.push("monitor"),
            closeRefreshScheduler: () => closed.push("refresh"),
            closeDaemonClient: () => closed.push("client"),
          },
        }),
      ).rejects.toThrow("cannot re-exec: process.argv is empty");
      expect(closed).toEqual(["monitor", "refresh", "client"]);
    } finally {
      process.argv = originalArgv;
    }
  });

  test("uses the provided argv override instead of process.argv when set", async () => {
    const originalArgv = process.argv;
    // Non-empty, so this proves the empty `argv` override below is what's actually used.
    process.argv = ["/usr/bin/node", "/path/to/cli.js", "tui"];
    try {
      // Mutation checkpoint: swapping `params.argv ?? process.argv` to prefer `process.argv`
      // would use the non-empty ambient argv above and never throw.
      await expect(
        performTuiRevisionReexec({
          daemonRevision: "rev-b",
          carriedState: { selectedNodeId: null, expandedPipelineNodeIds: [] },
          argv: [],
          teardown: {
            closeMonitor: () => {},
            closeRefreshScheduler: () => {},
            closeDaemonClient: () => {},
          },
        }),
      ).rejects.toThrow("cannot re-exec: process.argv is empty");
    } finally {
      process.argv = originalArgv;
    }
  });

  test("publishes revision/state and exits reserved without spawning", async () => {
    const closed: string[] = [];
    let published: TuiRevisionReexecChannelPayload | undefined;
    let exitCode: number | undefined;
    await performTuiRevisionReexec({
      daemonRevision: "rev-stable",
      carriedState: { selectedNodeId: "run-a", expandedPipelineNodeIds: ["pipe-a"] },
      argv: ["/usr/bin/node", "/path/cli.js", "tui"],
      teardown: {
        closeMonitor: () => closed.push("monitor"),
        closeRefreshScheduler: () => closed.push("refresh"),
        closeDaemonClient: () => closed.push("client"),
      },
      channel: {
        publish(payload) {
          published = payload;
        },
        take() {
          return undefined;
        },
      },
      exitProcess(code) {
        exitCode = code;
      },
    });
    expect(closed).toEqual(["monitor", "refresh", "client"]);
    expect(published).toEqual({
      daemonRevision: "rev-stable",
      carriedState: { selectedNodeId: "run-a", expandedPipelineNodeIds: ["pipe-a"] },
    });
    expect(exitCode).toBe(TUI_REVISION_REEXEC_EXIT_CODE);
  });
});
