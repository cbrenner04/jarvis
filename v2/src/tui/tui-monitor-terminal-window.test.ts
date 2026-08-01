import { describe, expect, test } from "bun:test";
import type { DaemonListResult, DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { TuiDaemonClient } from "./tui-daemon-client.ts";
import { runTuiEntry } from "./tui-entry.tsx";
import { monitorLeftPaneTreeRows } from "./tui-monitor-lines.ts";
import {
  filterMonitorRunsForLiveWindow,
  TUI_TERMINAL_ROW_CAP,
  TUI_TERMINAL_WINDOW_MS,
  terminalRunInLiveWindow,
} from "./tui-monitor-terminal-window.ts";
import type { TuiMonitorState, TuiViewHost } from "./tui-monitor-types.ts";
import { computeShellLayout, monitorTreeRun } from "./tui-shell-layout.ts";

const FIXED_NOW = 1_700_000_000_000;

function terminalRow(runId: string, finishedAtMs: number): DaemonListRunRow {
  return {
    runId,
    project: "demo",
    branch: runId,
    createdAt: 0,
    status: "completed",
    isLive: false,
    finishedAtMs,
  };
}

function finishlessRow(status: "killed" | "interrupted"): DaemonListRunRow {
  return {
    runId: "run-finishless",
    project: "demo",
    branch: "finishless",
    createdAt: 0,
    status,
    isLive: false,
  };
}

describe("terminalRunInLiveWindow", () => {
  test("keeps finishes inside the window", () => {
    expect(terminalRunInLiveWindow(FIXED_NOW - 30 * 60_000, FIXED_NOW, TUI_TERMINAL_WINDOW_MS)).toBe(true);
    expect(terminalRunInLiveWindow(FIXED_NOW - TUI_TERMINAL_WINDOW_MS, FIXED_NOW, TUI_TERMINAL_WINDOW_MS)).toBe(true);
  });

  test("drops finishes before the window", () => {
    expect(terminalRunInLiveWindow(FIXED_NOW - TUI_TERMINAL_WINDOW_MS - 1, FIXED_NOW, TUI_TERMINAL_WINDOW_MS)).toBe(
      false,
    );
  });

  test("treats missing finishedAtMs as in-window", () => {
    expect(terminalRunInLiveWindow(undefined, FIXED_NOW, TUI_TERMINAL_WINDOW_MS)).toBe(true);
  });
});

describe("filterMonitorRunsForLiveWindow", () => {
  test("retains non-terminal rows and caps terminal rows by finish time", () => {
    const active: DaemonListRunRow = {
      runId: "run-active",
      project: "demo",
      branch: "active",
      createdAt: 0,
      status: "in-progress",
      isLive: true,
    };
    const terminals = Array.from({ length: 22 }, (_, index) =>
      terminalRow(`run-t-${index}`, FIXED_NOW - index * 1_000),
    );
    const stale = terminalRow("run-stale", FIXED_NOW - 2 * TUI_TERMINAL_WINDOW_MS);

    const filtered = filterMonitorRunsForLiveWindow([stale, active, ...terminals], { nowMs: FIXED_NOW });
    expect(filtered.map((row) => row.runId)).toEqual([
      active.runId,
      ...terminals.slice(0, TUI_TERMINAL_ROW_CAP).map((row) => row.runId),
    ]);
    expect(filtered.some((row) => row.runId === "run-stale")).toBe(false);
    expect(filtered.filter((row) => row.status === "completed")).toHaveLength(TUI_TERMINAL_ROW_CAP);
    expect(filtered.filter((row) => row.status === "completed").map((row) => row.runId)).toEqual(
      terminals.slice(0, TUI_TERMINAL_ROW_CAP).map((row) => row.runId),
    );
  });

  test("preserves merge order among non-terminal standalones and active workflows", () => {
    const pausedFirst: DaemonListRunRow = {
      runId: "paused-first",
      project: "demo",
      branch: "first",
      createdAt: 0,
      status: "paused",
      isLive: false,
    };
    const workflowMember: DaemonListRunRow = {
      runId: "run-wf-active",
      project: "demo",
      branch: "wf",
      createdAt: 0,
      status: "in-progress",
      isLive: true,
      stepId: "implement",
      workflow: {
        invocationId: "inv-active",
        steps: [{ stepId: "implement", role: "implement", status: "in_progress", attemptCount: 1 }],
      },
    };
    const pausedSecond: DaemonListRunRow = {
      runId: "paused-second",
      project: "demo",
      branch: "second",
      createdAt: 0,
      status: "paused",
      isLive: false,
    };

    const filtered = filterMonitorRunsForLiveWindow([pausedFirst, workflowMember, pausedSecond], { nowMs: FIXED_NOW });
    expect(filtered.map((row) => row.runId)).toEqual([pausedFirst.runId, workflowMember.runId, pausedSecond.runId]);
  });

  test("terminal cap counts collapsed workflow invocations, not constituent runs", () => {
    const invocations = Array.from({ length: 21 }, (_, index) => {
      const invocationId = `inv-terminal-${index}`;
      const finishedAtMs = FIXED_NOW - index * 1_000;
      const workflow = {
        invocationId,
        steps: [
          {
            stepId: "implement",
            role: "implement",
            status: "completed" as const,
            attemptCount: 1,
            terminalOutcome: "complete",
          },
          {
            stepId: "verify",
            role: "verify",
            status: "completed" as const,
            attemptCount: 1,
            terminalOutcome: "complete",
          },
        ],
      };
      return [
        {
          runId: `run-${index}-implement`,
          project: "demo",
          branch: `b-${index}`,
          createdAt: 0,
          status: "completed" as const,
          isLive: false,
          finishedAtMs,
          stepId: "implement",
          workflow,
        },
        {
          runId: `run-${index}-verify`,
          project: "demo",
          branch: `b-${index}-verify`,
          createdAt: 0,
          status: "completed" as const,
          isLive: false,
          finishedAtMs,
          stepId: "verify",
          workflow,
        },
      ] satisfies DaemonListRunRow[];
    });
    const runs = invocations.flat();

    const filtered = filterMonitorRunsForLiveWindow(runs, { nowMs: FIXED_NOW });
    const keptInvocationIds = new Set(
      filtered.map((row) => row.workflow?.invocationId).filter((id): id is string => id !== undefined),
    );
    expect(keptInvocationIds.size).toBe(TUI_TERMINAL_ROW_CAP);
    expect(filtered).toHaveLength(TUI_TERMINAL_ROW_CAP * 2);
  });

  test("keeps terminal rows with omitted finishedAtMs in the live window", () => {
    const finishless = finishlessRow("killed");
    const active: DaemonListRunRow = {
      runId: "run-active",
      project: "demo",
      branch: "active",
      createdAt: 0,
      status: "in-progress",
      isLive: true,
    };

    const filtered = filterMonitorRunsForLiveWindow([finishless, active], { nowMs: FIXED_NOW });
    // Mutation checkpoint: return true → return false on the finishedAtMs === undefined branch.
    expect(filtered.map((row) => row.runId)).toEqual([active.runId, finishless.runId]);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function createViewHost() {
  const monitorStates: TuiMonitorState[] = [];
  const exit = deferred<void>();
  const opened = deferred<void>();

  const host: TuiViewHost = {
    show() {},
    async openMonitor(state) {
      monitorStates.push(structuredClone(state));
      opened.resolve();
      return {
        update(nextState) {
          monitorStates.push(structuredClone(nextState));
        },
        waitUntilExit() {
          return exit.promise;
        },
        close() {},
      };
    },
  };

  return {
    host,
    monitorStates,
    async waitUntilOpen() {
      await opened.promise;
    },
    quit() {
      exit.resolve();
    },
  };
}

function fakeClient(listResponses: DaemonListResult[]): TuiDaemonClient {
  let listIndex = 0;
  return {
    async health() {
      return { ok: true };
    },
    async status() {
      return { state: "running" };
    },
    async list() {
      const response = listResponses[Math.min(listIndex, listResponses.length - 1)];
      listIndex += 1;
      return response ?? { runs: [] };
    },
    async pipelineList() {
      return { pipelines: [] };
    },
    async start() {
      return { runId: "unused" };
    },
    async pause() {
      return { ok: true };
    },
    async resume() {
      return { ok: true };
    },
    async kill() {
      return { ok: true };
    },
    async wait() {
      return { runStatus: "completed" };
    },
    close() {},
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function tableRunIds(state: TuiMonitorState): string[] {
  const layout = computeShellLayout(245, 72, 0);
  const { treeRows, unattributedRows } = monitorLeftPaneTreeRows(state, layout, FIXED_NOW);
  const treeRunIds = treeRows.filter((row) => row.kind === "run").map((row) => row.id);
  const unattributedIds = unattributedRows.map((row) => monitorTreeRun(row).runId);
  return [...treeRunIds, ...unattributedIds];
}

async function renderedTableRunIds(runs: DaemonListRunRow[]): Promise<string[]> {
  const view = createViewHost();
  const pending = runTuiEntry({
    socketPath: "/tmp/test.sock",
    nowMs: () => FIXED_NOW,
    viewHost: view.host,
    connectTuiDaemon: async () => fakeClient([{ runs }]),
    socketDiscovery: async () => [],
  });
  await view.waitUntilOpen();
  await flush();
  const state = view.monitorStates.at(-1);
  if (!state) throw new Error("missing monitor state");
  const renderedIds = tableRunIds(state);
  view.quit();
  await pending;
  return renderedIds;
}

describe("runTuiEntry terminal live window", () => {
  function buildFixtureRuns(): DaemonListRunRow[] {
    const activeOld: DaemonListRunRow = {
      runId: "run-paused-old",
      project: "demo",
      branch: "paused-old",
      createdAt: 0,
      status: "paused",
      isLive: false,
    };
    const stale = terminalRow("run-stale", FIXED_NOW - 2 * TUI_TERMINAL_WINDOW_MS);
    const terminals = Array.from({ length: 22 }, (_, index) =>
      terminalRow(`run-t-${index}`, FIXED_NOW - index * 1_000),
    );
    return [stale, activeOld, ...terminals];
  }

  test("renders in-window terminal rows in finish order, capped at twenty, and keeps old active rows", async () => {
    const renderedIds = await renderedTableRunIds(buildFixtureRuns());
    expect(renderedIds[0]).toBe("run-paused-old");
    expect(renderedIds.includes("run-stale")).toBe(false);
    const terminalRendered = renderedIds.filter((id) => id.startsWith("run-t-"));
    expect(terminalRendered).toHaveLength(TUI_TERMINAL_ROW_CAP);
    expect(terminalRendered).toEqual(Array.from({ length: TUI_TERMINAL_ROW_CAP }, (_, index) => `run-t-${index}`));
    expect(renderedIds.includes("run-paused-old")).toBe(true);
  });

  test("renders finishless terminal rows below the twenty-row cap", async () => {
    const runs = [
      finishlessRow("interrupted"),
      ...Array.from({ length: 3 }, (_, index) => terminalRow(`run-t-${index}`, FIXED_NOW - index * 1_000)),
    ];
    const renderedIds = await renderedTableRunIds(runs);
    expect(renderedIds.includes("run-finishless")).toBe(true);
  });
});
