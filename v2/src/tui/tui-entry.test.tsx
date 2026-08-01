import { describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import { createElement, type ReactElement } from "react";
import type { WaitRunCompletionResult } from "../daemon/daemon.ts";
import type { DaemonListResult, DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { PipelineSnapshot } from "../daemon/pipeline-observation.ts";
import { RpcConnectionError, RpcError } from "../ipc/rpc-errors.ts";
import type { PipelineListResult, TuiDaemonClient } from "./tui-daemon-client.ts";
import { TUI_DAEMON_SOCKET_DISPLAY } from "./tui-daemon-errors.ts";
import { runTuiEntry } from "./tui-entry.tsx";
import type { InkRender } from "./tui-ink-feedback.tsx";
import type { InjectedInkUi, InkUseInput } from "./tui-ink-runtime.ts";
import { monitorLeftPaneTreeRows, monitorTextLines } from "./tui-monitor-lines.ts";
import { monitorPipelineStageNodeId } from "./tui-monitor-pipeline-tree.ts";
import type {
  RunTuiEntryDeps,
  TuiMonitorControls,
  TuiMonitorSession,
  TuiMonitorState,
  TuiViewHost,
  TuiViewState,
} from "./tui-monitor-types.ts";
import { computeShellLayout, monitorTreeRun } from "./tui-shell-layout.ts";

const TERMINAL_LIST_FINISH_MS = 9_000_000_000_000;

const RUN_ALPHA: DaemonListRunRow = {
  runId: "run-alpha",
  project: "demo",
  branch: "alpha",
  status: "in-progress",
  isLive: true,
};

const RUN_BETA: DaemonListRunRow = {
  runId: "run-beta",
  project: "demo",
  branch: "beta",
  status: "completed",
  isLive: false,
  finishedAtMs: TERMINAL_LIST_FINISH_MS,
};

const RUN_GAMMA: DaemonListRunRow = {
  runId: "run-gamma",
  project: "demo",
  branch: "gamma",
  status: "blocked",
  isLive: false,
  finishedAtMs: TERMINAL_LIST_FINISH_MS,
};

const RUN_DELTA: DaemonListRunRow = {
  runId: "run-delta",
  project: "demo",
  branch: "delta",
  status: "paused",
  isLive: false,
};

const RUN_QUEUED: DaemonListRunRow = {
  runId: "run-queued",
  project: "demo",
  branch: "queued",
  status: "queued",
  isLive: false,
};

const PIPELINE_SNAPSHOT_ALPHA: PipelineSnapshot = {
  pipelineId: "pipe-alpha",
  name: "alpha-pipeline",
  state: "running",
  createdAt: 1_700_000_000_000,
  finishedAtMs: null,
  stages: [{ stageId: "plan", branchKey: "default", status: "running", workflowInvocationId: "inv-1" }],
};

const PIPELINE_SNAPSHOT_BETA: PipelineSnapshot = {
  pipelineId: "pipe-beta",
  name: "beta-pipeline",
  state: "succeeded",
  createdAt: 1_700_000_001_000,
  finishedAtMs: 1_700_000_002_000,
  stages: [{ stageId: "s1", branchKey: "default", status: "succeeded", workflowInvocationId: "inv-2" }],
};

const PIPELINE_STAGE_ALPHA = monitorPipelineStageNodeId("pipe-alpha", "plan", "default");

const PIPELINE_MULTI_INVOCATION = "inv-multi";
const PIPELINE_MULTI_STEPS = [
  { stepId: "implement", role: "implement", status: "completed", attemptCount: 1, terminalOutcome: "complete" },
  { stepId: "implement-review", role: "actuator", status: "in_progress", attemptCount: 1 },
] as const;

const PIPELINE_SNAPSHOT_MULTI: PipelineSnapshot = {
  pipelineId: "pipe-multi",
  name: "multi-pipeline",
  state: "running",
  createdAt: 1_700_000_000_000,
  finishedAtMs: null,
  stages: [
    {
      stageId: "implement",
      branchKey: "default",
      status: "running",
      workflowInvocationId: PIPELINE_MULTI_INVOCATION,
    },
  ],
};

const PIPELINE_STAGE_MULTI = monitorPipelineStageNodeId("pipe-multi", "implement", "default");

function pipelineMultiRun(
  overrides: Partial<DaemonListRunRow> & Pick<DaemonListRunRow, "runId" | "stepId" | "status">,
): DaemonListRunRow {
  return {
    project: "demo",
    branch: "main",
    isLive: overrides.status === "in-progress",
    workflow: {
      invocationId: PIPELINE_MULTI_INVOCATION,
      steps: [...PIPELINE_MULTI_STEPS],
    },
    ...overrides,
  };
}

function pipelineMultiListFixture(): DaemonListRunRow[] {
  return [
    pipelineMultiRun({ runId: "run-implement", stepId: "implement", status: "completed", isLive: false }),
    pipelineMultiRun({ runId: "run-review", stepId: "implement-review", status: "in-progress" }),
    PIPELINE_RUN_ORPHAN,
  ];
}

function leftPaneTreeRowIds(state: TuiMonitorState | undefined): string[] {
  if (state === undefined) return [];
  const layout = computeShellLayout(state.terminalColumns ?? 245, state.terminalRows ?? 72, state.dividerOffset ?? 0);
  const { treeRows, unattributedRows } = monitorLeftPaneTreeRows(state, layout, WORKFLOW_FILTER_NOW_MS);
  return [...treeRows.map((row) => row.id), ...unattributedRows.map((row) => monitorTreeRun(row).runId)];
}

function pipelineMultiEntryDeps(view: ReturnType<typeof createViewHost>, overrides: Partial<RunTuiEntryDeps> = {}) {
  return entryDeps(
    {
      methods: [],
      listResponses: [{ runs: pipelineMultiListFixture() }],
      pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_MULTI] }],
      waitImpl: async () => ({ runStatus: "completed" }),
    },
    {
      viewHost: view.host,
      nowMs: () => WORKFLOW_FILTER_NOW_MS,
      terminalSize: () => ({ columns: 245, rows: 72 }),
      ...overrides,
    },
  );
}

const PIPELINE_RUN_MATCHED: DaemonListRunRow = {
  runId: "run-matched",
  project: "demo",
  branch: "main",
  status: "in-progress",
  isLive: true,
  workflow: {
    invocationId: "inv-1",
    steps: [{ stepId: "plan", role: "plan", status: "in_progress", attemptCount: 1 }],
  },
};

const PIPELINE_RUN_ORPHAN: DaemonListRunRow = {
  runId: "run-orphan",
  project: "demo",
  branch: "orphan",
  status: "completed",
  isLive: false,
  finishedAtMs: TERMINAL_LIST_FINISH_MS,
  workflow: {
    invocationId: "inv-orphan",
    steps: [{ stepId: "x", role: "implement", status: "completed", attemptCount: 1 }],
  },
};

function pipelineTreeListFixture(): DaemonListRunRow[] {
  return [PIPELINE_RUN_MATCHED, PIPELINE_RUN_ORPHAN];
}

function pipelineTreeWithOutsideRunFixture(): DaemonListRunRow[] {
  return [PIPELINE_RUN_MATCHED, PIPELINE_RUN_ORPHAN, RUN_ALPHA];
}

function pipelineTreeEntryDeps(
  view: ReturnType<typeof createViewHost>,
  overrides: Partial<RunTuiEntryDeps> = {},
  runs: DaemonListRunRow[] = pipelineTreeListFixture(),
) {
  return entryDeps(
    {
      methods: [],
      listResponses: [{ runs }],
      pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_ALPHA] }],
      waitImpl: async () => ({ runStatus: "completed" }),
    },
    {
      viewHost: view.host,
      nowMs: () => WORKFLOW_FILTER_NOW_MS,
      ...overrides,
    },
  );
}

const DAEMON1_SOCKET = "/tmp/daemon1.sock";
const DAEMON2_SOCKET = "/tmp/daemon2.sock";

const WORKFLOW_FILTER_NOW_MS = 1_700_000_000_000;
const WORKFLOW_INVOCATION_ID = "inv-implement-review";

const WORKFLOW_STEPS = [
  { stepId: "implement", role: "implement", status: "completed", attemptCount: 2, terminalOutcome: "complete" },
  { stepId: "implement-review", role: "actuator", status: "in_progress", attemptCount: 1 },
  { stepId: "verify", role: "verify", status: "pending", attemptCount: 0 },
] as const;

function workflowRun(
  overrides: Partial<DaemonListRunRow> & Pick<DaemonListRunRow, "runId" | "stepId" | "branch" | "status">,
): DaemonListRunRow {
  return {
    project: "demo",
    isLive: overrides.status === "in-progress",
    workflow: {
      invocationId: WORKFLOW_INVOCATION_ID,
      steps: [...WORKFLOW_STEPS],
    },
    ...overrides,
  };
}

function _workflowListFixture(): DaemonListRunRow[] {
  return [
    workflowRun({
      runId: "run-implement",
      stepId: "implement",
      branch: "feature",
      status: "completed",
      isLive: false,
      finishedAtMs: WORKFLOW_FILTER_NOW_MS - 1_000,
    }),
    workflowRun({
      runId: "run-review",
      stepId: "implement-review",
      branch: "feature-review",
      status: "in-progress",
      isLive: true,
    }),
    workflowRun({
      runId: "run-verify",
      stepId: "verify",
      branch: "feature-verify",
      status: "queued",
      isLive: false,
    }),
  ];
}

function stripAnsi(text: string): string {
  return text.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");
}

function flattenRenderedText(stdoutText: string): string {
  return stripAnsi(stdoutText).replace(/\s+/g, " ").trim();
}

function _tableBodyText(rendered: string): string {
  const text = flattenRenderedText(rendered);
  const header = "runId project branch status liveness";
  const headerIndex = text.indexOf(header);
  if (headerIndex === -1) return text;
  const start = headerIndex + header.length;
  const queueIndex = text.indexOf(" Queue ", start);
  const end = queueIndex === -1 ? text.length : queueIndex;
  return text.slice(start, end);
}

function _inkInputHarness() {
  let inputHandler: Parameters<InkUseInput>[0] | undefined;
  let instance: Awaited<ReturnType<InkRender>> | undefined;
  let stdoutText = "";
  const opened = deferred<void>();
  let openedOnce = false;

  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      stdoutText += chunk.toString();
      callback();
    },
  }) as NodeJS.WriteStream;
  stdout.isTTY = true;
  stdout.columns = 120;

  const useInput: InkUseInput = (nextHandler) => {
    inputHandler = nextHandler;
  };

  /**
   * Waits for a complete painted frame. A fixed flush-render-flush sequence can return before ink
   * paints on a loaded machine (empty text), or mid-paint (partial text), so drain until the
   * rendered text is non-empty and stops changing.
   */
  async function drainUntilFrameSettles(inkInstance: NonNullable<typeof instance>): Promise<void> {
    let previous: string | undefined;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await inkInstance.waitUntilRenderFlush();
      await flush();
      await inkInstance.waitUntilRenderFlush();
      const current = flattenRenderedText(stdoutText);
      if (current !== "" && current === previous) return;
      previous = current;
    }
  }

  return {
    async injection(): Promise<InjectedInkUi> {
      const ink = await import("ink");
      return {
        renderFn: ((element: ReactElement) => {
          if (!openedOnce) {
            openedOnce = true;
            opened.resolve();
          }
          instance = ink.render(element, { exitOnCtrlC: false, stdout, patchConsole: false });
          return instance;
        }) as InkRender,
        Text: ({ children, color }) => createElement(ink.Text, color === undefined ? null : { color }, children),
        useInput,
      };
    },
    async waitUntilOpen() {
      await opened.promise;
      if (instance === undefined) throw new Error("expected ink instance");
      await drainUntilFrameSettles(instance);
    },
    async press(input: string, key: Parameters<Parameters<InkUseInput>[0]>[1] = {}) {
      if (inputHandler === undefined) throw new Error("expected input handler");
      stdoutText = "";
      inputHandler(input, key);
      if (instance === undefined) throw new Error("expected ink instance");
      await drainUntilFrameSettles(instance);
    },
    renderedText() {
      return flattenRenderedText(stdoutText);
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function cloneState(state: TuiMonitorState): TuiMonitorState {
  return structuredClone(state);
}

function createRefreshScheduler() {
  let onRefresh: (() => void) | undefined;
  let closed = false;
  return {
    scheduler: {
      start(callback: () => void) {
        onRefresh = callback;
        return {
          close() {
            closed = true;
          },
        };
      },
    },
    tick() {
      onRefresh?.();
    },
    isClosed() {
      return closed;
    },
  };
}

function createViewHost() {
  const feedbackStates: TuiViewState[] = [];
  const monitorStates: TuiMonitorState[] = [];
  let controls: TuiMonitorControls | undefined;
  let closed = false;
  const exit = deferred<void>();
  const opened = deferred<void>();

  const host: TuiViewHost = {
    show(state) {
      feedbackStates.push(state);
    },
    async openMonitor(state, nextControls): Promise<TuiMonitorSession> {
      controls = nextControls;
      monitorStates.push(cloneState(state));
      opened.resolve();
      return {
        update(nextState) {
          monitorStates.push(cloneState(nextState));
        },
        waitUntilExit() {
          return exit.promise;
        },
        close() {
          closed = true;
        },
      };
    },
  };

  return {
    host,
    feedbackStates,
    monitorStates,
    async waitUntilOpen() {
      await opened.promise;
    },
    selectNode(nodeId: string) {
      controls?.selectNode(nodeId);
    },
    selectNextRun() {
      controls?.selectNextRun();
    },
    selectPreviousRun() {
      controls?.selectPreviousRun();
    },
    pauseSelected() {
      controls?.pauseSelected();
    },
    resumeSelected() {
      controls?.resumeSelected();
    },
    killSelected() {
      controls?.killSelected();
    },
    toggleSelectedWorkflowExpansion() {
      controls?.toggleSelectedWorkflowExpansion();
    },
    quit() {
      controls?.quit();
      exit.resolve();
    },
    isClosed() {
      return closed;
    },
  };
}

function nextFakeResponse<T>(responses: T[] | undefined, index: number): [T | undefined, number] {
  if (!responses?.length) return [undefined, index + 1];
  return [responses[Math.min(index, responses.length - 1)], index + 1];
}

function countRpcMethod(methods: string[] | undefined, method: string): number {
  return methods?.filter((entry) => entry === method).length ?? 0;
}

async function flushRefreshTick(refresh: ReturnType<typeof createRefreshScheduler>): Promise<void> {
  refresh.tick();
  await flush();
  await flush();
  await flush();
}

function dualDaemonEntryDeps(
  client1Options: FakeClientOptions,
  client2Options: FakeClientOptions,
  overrides: Partial<RunTuiEntryDeps> = {},
): { deps: RunTuiEntryDeps; client1Options: FakeClientOptions; client2Options: FakeClientOptions } {
  const clients = [fakeClient(client1Options), fakeClient(client2Options)];
  let clientIndex = 0;
  const { deps } = entryDeps(
    {},
    {
      socketPath: DAEMON1_SOCKET,
      connectTuiDaemon: async () => {
        const client = clients[clientIndex++];
        if (!client) throw new Error(`no client at index ${clientIndex - 1}`);
        return client;
      },
      socketDiscovery: async () => [DAEMON1_SOCKET, DAEMON2_SOCKET],
      ...overrides,
    },
  );
  return { deps, client1Options, client2Options };
}

type FakeClientOptions = {
  methods?: string[];
  healthError?: RpcError;
  statusError?: RpcError;
  listResponses?: DaemonListResult[];
  listError?: Error;
  pipelineListResponses?: PipelineListResult[];
  pipelineListError?: Error;
  waitImpl?: (runId: string) => Promise<WaitRunCompletionResult>;
  pauseError?: Error;
  resumeError?: Error;
  killError?: Error;
  pauseImpl?: (runId: string) => Promise<{ ok: true }>;
  resumeImpl?: (runId: string) => Promise<{ ok: true }>;
  killImpl?: (runId: string) => Promise<{ ok: true }>;
};

function fakeClient(options: FakeClientOptions = {}): TuiDaemonClient {
  const methods = options.methods ?? [];
  let listIndex = 0;
  let pipelineListIndex = 0;

  const steer =
    (method: "pause" | "kill") =>
    async (runId: string): Promise<{ ok: true }> => {
      methods.push(`${method}:${runId}`);
      const errorKey = `${method}Error` as const;
      if (options[errorKey] !== undefined) throw options[errorKey];
      const impl = options[`${method}Impl` as const];
      return (impl ?? (async () => ({ ok: true as const })))(runId);
    };

  const resume = async (runId: string): Promise<{ ok: true }> => {
    methods.push(`resume:${runId}`);
    if (options.resumeError !== undefined) throw options.resumeError;
    return (options.resumeImpl ?? (async () => ({ ok: true as const })))(runId);
  };

  return {
    async health() {
      methods.push("health");
      if (options.healthError !== undefined) throw options.healthError;
      return { ok: true };
    },
    async status() {
      methods.push("status");
      if (options.statusError !== undefined) throw options.statusError;
      return { state: "running" };
    },
    async list() {
      methods.push("list");
      if (options.listError !== undefined) throw options.listError;
      const [response, nextIndex] = nextFakeResponse(options.listResponses, listIndex);
      listIndex = nextIndex;
      return response ?? { runs: [] };
    },
    async pipelineList() {
      methods.push("pipeline_list");
      if (options.pipelineListError !== undefined) throw options.pipelineListError;
      const [response, nextIndex] = nextFakeResponse(options.pipelineListResponses, pipelineListIndex);
      pipelineListIndex = nextIndex;
      return response ?? { pipelines: [] };
    },
    async start() {
      methods.push("start");
      return { runId: "unused" };
    },
    pause: steer("pause"),
    resume,
    kill: steer("kill"),
    async wait(runId: string) {
      methods.push(`wait:${runId}`);
      return (options.waitImpl ?? (async () => ({ runStatus: "completed" })))(runId);
    },
    close() {
      methods.push("close");
    },
  };
}

function entryDeps(
  clientOptions: FakeClientOptions = {},
  overrides: Partial<RunTuiEntryDeps> = {},
): { deps: RunTuiEntryDeps; clientOptions: FakeClientOptions } {
  return {
    clientOptions,
    deps: {
      socketPath: "/tmp/test.sock",
      connectTuiDaemon: async () => fakeClient(clientOptions),
      socketDiscovery: async () => [],
      ...overrides,
    } as RunTuiEntryDeps,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("runTuiEntry", () => {
  test("unavailable daemon at connect records unavailable feedback, exits 1, and skips list/wait", async () => {
    const view = createViewHost();
    let attempted = false;

    const code = await runTuiEntry({
      socketPath: "/tmp/test.sock",
      viewHost: view.host,
      connectTuiDaemon: async () => {
        attempted = true;
        throw new RpcConnectionError("cannot connect");
      },
    });

    expect(code).toBe(1);
    expect(attempted).toBe(true);
    expect(view.feedbackStates).toEqual([{ kind: "unavailable" }]);
    expect(TUI_DAEMON_SOCKET_DISPLAY).toBe("~/.jarvis/daemon.sock");
  });

  test("monitor state carries the injected terminal size", async () => {
    // Mutation checkpoint: flipping `stdout.columns !== undefined` to `===` in tui-entry.tsx
    // (same for rows) leaves terminalColumns/terminalRows unset — this pin turns RED.
    const view = createViewHost();
    const { deps } = entryDeps(
      { listResponses: [{ runs: [RUN_ALPHA] }], waitImpl: async () => ({ runStatus: "completed" }) },
      { viewHost: view.host, terminalSize: () => ({ columns: 245, rows: 72 }) },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();

    const opened = view.monitorStates.at(-1);
    expect(opened?.terminalColumns).toBe(245);
    expect(opened?.terminalRows).toBe(72);

    view.quit();
    expect(await pending).toBe(0);
  });

  test("monitor state omits terminal size when the terminal reports none", async () => {
    // Mutation checkpoint: dropping the `!== undefined` guards entirely would write `undefined`
    // keys onto the state; this pin asserts the fields stay absent.
    const view = createViewHost();
    const { deps } = entryDeps(
      { listResponses: [{ runs: [RUN_ALPHA] }], waitImpl: async () => ({ runStatus: "completed" }) },
      { viewHost: view.host, terminalSize: () => ({}) },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();

    const opened = view.monitorStates.at(-1);
    expect(opened === undefined ? true : "terminalColumns" in opened).toBe(false);
    expect(opened === undefined ? true : "terminalRows" in opened).toBe(false);

    view.quit();
    expect(await pending).toBe(0);
  });

  test("drives pipeline tree expansion through the injected input hook", async () => {
    // Mutation checkpoint: short-circuiting `toggleSelectedWorkflowExpansion` in tui-entry.tsx before
    // it mutates `expandedPipelineNodeIds` must turn stage constituent rows RED.
    // Mutation checkpoint: skipping the `e` binding in tui-ink-monitor.tsx must turn pipeline/stage expansion RED.
    const view = createViewHost();
    const { deps } = pipelineMultiEntryDeps(view);

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();

    view.selectNode(PIPELINE_STAGE_MULTI);
    await flush();
    expect(leftPaneTreeRowIds(view.monitorStates.at(-1))).toContain("run-implement");

    view.toggleSelectedWorkflowExpansion();
    await flush();
    expect(view.monitorStates.at(-1)?.expandedPipelineNodeIds ?? []).toContain(PIPELINE_STAGE_MULTI);

    view.selectNode("run-orphan");
    await flush();
    expect(leftPaneTreeRowIds(view.monitorStates.at(-1))).not.toContain("run-implement");

    view.selectPreviousRun();
    await flush();
    view.selectNextRun();
    await flush();
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe(PIPELINE_STAGE_MULTI);
    expect(leftPaneTreeRowIds(view.monitorStates.at(-1))).toContain("run-implement");

    view.toggleSelectedWorkflowExpansion();
    await flush();
    expect(view.monitorStates.at(-1)?.expandedPipelineNodeIds ?? []).not.toContain(PIPELINE_STAGE_MULTI);

    view.selectNode("run-orphan");
    await flush();
    expect(leftPaneTreeRowIds(view.monitorStates.at(-1))).not.toContain("run-implement");
    expect("expandedWorkflowInvocationIds" in (view.monitorStates.at(-1) ?? {})).toBe(false);

    view.quit();
    expect(await pending).toBe(0);
  });

  test("e on a selected pipeline without seeding expandedPipelineNodeIds reveals stage and run rows after the first press and hides them after the second", async () => {
    const view = createViewHost();
    const { deps } = pipelineMultiEntryDeps(view);

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();

    view.selectNode("pipe-multi");
    await flush();
    expect(view.monitorStates.at(-1)?.expandedPipelineNodeIds ?? []).not.toContain("pipe-multi");
    view.toggleSelectedWorkflowExpansion();
    await flush();
    expect(view.monitorStates.at(-1)?.expandedPipelineNodeIds ?? []).toContain("pipe-multi");

    view.selectNode("run-orphan");
    await flush();
    expect(leftPaneTreeRowIds(view.monitorStates.at(-1))).toEqual([
      "pipe-multi",
      PIPELINE_STAGE_MULTI,
      "run-review",
      "run-orphan",
    ]);

    view.selectNode("pipe-multi");
    await flush();
    expect(view.monitorStates.at(-1)?.expandedPipelineNodeIds).toContain("pipe-multi");
    view.selectNode("run-orphan");
    await flush();
    expect(leftPaneTreeRowIds(view.monitorStates.at(-1))).toEqual([
      "pipe-multi",
      PIPELINE_STAGE_MULTI,
      "run-review",
      "run-orphan",
    ]);

    view.selectNode("pipe-multi");
    await flush();
    view.toggleSelectedWorkflowExpansion();
    await flush();
    view.selectNode("run-orphan");
    await flush();
    expect(leftPaneTreeRowIds(view.monitorStates.at(-1))).toEqual(["pipe-multi", "run-orphan"]);

    view.quit();
    expect(await pending).toBe(0);
  });

  test("e on a selected run leaf leaves expandedPipelineNodeIds unchanged", async () => {
    const view = createViewHost();
    const { deps } = pipelineMultiEntryDeps(view);

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();

    view.selectNode("run-review");
    await flush();
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe("run-review");
    const before = [...(view.monitorStates.at(-1)?.expandedPipelineNodeIds ?? [])].sort();

    view.toggleSelectedWorkflowExpansion();
    await flush();
    expect([...(view.monitorStates.at(-1)?.expandedPipelineNodeIds ?? [])].sort()).toEqual(before);

    view.quit();
    expect(await pending).toBe(0);
  });

  test("reachable daemon proves health and status, enters the monitor on one open client, and exits 0 on quit", async () => {
    const view = createViewHost();
    const refresh = createRefreshScheduler();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_ALPHA] }],
        waitImpl: async () => ({ runStatus: "completed" }),
      },
      { viewHost: view.host, refreshScheduler: refresh.scheduler },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    view.quit();

    const code = await pending;

    expect(code).toBe(0);
    expect(clientOptions.methods).toEqual(["health", "status", "list", "pipeline_list", "wait:run-alpha", "close"]);
    expect(view.monitorStates[0]).toMatchObject({
      runs: [RUN_ALPHA],
      selectedNodeId: "run-alpha",
      waitState: { kind: "pending", runId: "run-alpha" },
    });
    expect(view.isClosed()).toBe(true);
    expect(refresh.isClosed()).toBe(true);
  });

  test("terminal-first daemon order selects the topmost active run and waits for it", async () => {
    const view = createViewHost();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_BETA, RUN_ALPHA] }],
        waitImpl: async () => ({ runStatus: "completed" }),
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    view.quit();
    await pending;

    expect(clientOptions.methods).toEqual(["health", "status", "list", "pipeline_list", "wait:run-alpha", "close"]);
    expect(view.monitorStates[0]?.selectedNodeId).toBe("run-alpha");
  });

  test("empty launch list shows an explicit empty state, does not select a run, and does not wait", async () => {
    const view = createViewHost();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [] }],
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    view.quit();
    await pending;

    expect(clientOptions.methods).toEqual(["health", "status", "list", "pipeline_list", "close"]);
    expect(view.monitorStates[0]).toEqual({
      runs: [],
      selectedNodeId: null,
      waitState: { kind: "none" },
      steeringFeedback: null,
      expandedPipelineNodeIds: [],
      refreshIntervalLabel: "1s",
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [] } },
    });
  });

  test("selectNode is a no-op for a queued run's id", async () => {
    const view = createViewHost();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_ALPHA, RUN_QUEUED] }],
        waitImpl: async () => ({ runStatus: "completed" }),
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    view.selectNode("run-queued");
    await flush();
    view.quit();
    await pending;

    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe("run-alpha");
    expect(clientOptions.methods).toEqual(["health", "status", "list", "pipeline_list", "wait:run-alpha", "close"]);
  });

  test("navigates selectable rows in rendered order, skipping queued rows and clamping", async () => {
    const view = createViewHost();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_BETA, RUN_QUEUED, RUN_ALPHA, RUN_GAMMA] }],
        waitImpl: async () => ({ runStatus: "completed" }),
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    view.selectNextRun();
    await flush();
    view.selectNextRun();
    await flush();
    view.selectNextRun();
    await flush();
    view.selectPreviousRun();
    await flush();
    view.quit();
    await pending;

    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe("run-beta");
    expect(clientOptions.methods).toEqual([
      "health",
      "status",
      "list",
      "pipeline_list",
      "wait:run-alpha",
      "wait:run-beta",
      "wait:run-gamma",
      "wait:run-beta",
      "close",
    ]);
  });

  test("drives row navigation through the injected input hook", async () => {
    const view = createViewHost();
    const { deps } = pipelineTreeEntryDeps(view, {
      terminalSize: () => ({ columns: 245, rows: 72 }),
    });

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();

    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe("pipe-alpha");

    view.selectNextRun();
    await flush();
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe(PIPELINE_STAGE_ALPHA);

    view.selectNextRun();
    await flush();
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe("run-matched");

    view.selectNextRun();
    await flush();
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe("run-orphan");

    view.selectPreviousRun();
    await flush();
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe("pipe-alpha");

    view.quit();
    expect(await pending).toBe(0);
  });

  test("after refresh, selectedNodeId is the first selectable tree or unattributed row in pane order", async () => {
    const view = createViewHost();
    const { deps } = pipelineTreeEntryDeps(
      view,
      { terminalSize: () => ({ columns: 245, rows: 72 }) },
      pipelineTreeWithOutsideRunFixture(),
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();

    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe("pipe-alpha");
    expect(view.monitorStates.at(-1)?.selectedNodeId).not.toBe("run-alpha");

    view.quit();
    expect(await pending).toBe(0);
  });

  test("when a refresh drops the selected id from the selectable list, selectedNodeId clears and wait-state resets", async () => {
    const view = createViewHost();
    const refresh = createRefreshScheduler();
    const { deps } = entryDeps(
      {
        listResponses: [{ runs: pipelineTreeListFixture() }, { runs: pipelineTreeListFixture() }],
        pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_ALPHA] }, { pipelines: [] }],
        waitImpl: async () => ({ runStatus: "completed" }),
      },
      {
        viewHost: view.host,
        refreshScheduler: refresh.scheduler,
        nowMs: () => WORKFLOW_FILTER_NOW_MS,
        terminalSize: () => ({ columns: 245, rows: 72 }),
      },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    view.selectNode(PIPELINE_STAGE_ALPHA);
    await flush();
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe(PIPELINE_STAGE_ALPHA);

    refresh.tick();
    await flush();
    await flush();

    expect(view.monitorStates.at(-1)?.selectedNodeId).toBeNull();
    expect(view.monitorStates.at(-1)?.waitState).toEqual({ kind: "none" });

    view.quit();
    expect(await pending).toBe(0);
  });

  test("kill and pause controls no-op when a pipeline or stage row is selected", async () => {
    const view = createViewHost();
    const { deps, clientOptions } = pipelineTreeEntryDeps(view, {
      terminalSize: () => ({ columns: 245, rows: 72 }),
    });

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    view.selectNode("pipe-alpha");
    await flush();
    view.pauseSelected();
    await flush();
    view.killSelected();
    await flush();
    view.selectNode(PIPELINE_STAGE_ALPHA);
    await flush();
    view.pauseSelected();
    await flush();
    view.killSelected();
    await flush();
    view.quit();
    await pending;

    expect(clientOptions.methods?.some((method) => method.startsWith("pause:"))).toBe(false);
    expect(clientOptions.methods?.some((method) => method.startsWith("kill:"))).toBe(false);
  });

  test("programmatic selectNode with a pipeline or stage id updates selectedNodeId", async () => {
    const view = createViewHost();
    const { deps } = pipelineTreeEntryDeps(view, {
      terminalSize: () => ({ columns: 245, rows: 72 }),
    });

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    view.selectNode(PIPELINE_STAGE_ALPHA);
    await flush();
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe(PIPELINE_STAGE_ALPHA);

    view.selectNode("pipe-alpha");
    await flush();
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe("pipe-alpha");

    view.quit();
    expect(await pending).toBe(0);
  });

  test("navigates from no selection and uses the selected run's refreshed display position", async () => {
    const view = createViewHost();
    const refresh = createRefreshScheduler();
    const { deps } = entryDeps(
      {
        listResponses: [
          { runs: [RUN_ALPHA, RUN_DELTA] },
          { runs: [RUN_DELTA, RUN_ALPHA] },
          { runs: [{ ...RUN_ALPHA, status: "queued", isLive: false }] },
          { runs: [RUN_BETA, RUN_ALPHA] },
        ],
        waitImpl: async () => ({ runStatus: "completed" }),
      },
      { viewHost: view.host, refreshScheduler: refresh.scheduler },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    view.selectNextRun();
    await flush();
    refresh.tick();
    await flush();
    await flush();
    await flush();
    view.selectNextRun();
    await flush();
    refresh.tick();
    await flush();
    await flush();
    await flush();
    refresh.tick();
    await flush();
    await flush();
    await flush();
    view.selectPreviousRun();
    await flush();
    view.quit();
    await pending;

    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe("run-beta");
  });

  test("refresh clears selection when the selected run transitions to queued", async () => {
    const view = createViewHost();
    const refresh = createRefreshScheduler();
    const { deps } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_ALPHA] }, { runs: [{ ...RUN_ALPHA, status: "queued", isLive: false }] }],
        waitImpl: async () => ({ runStatus: "completed" }),
      },
      { viewHost: view.host, refreshScheduler: refresh.scheduler },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    refresh.tick();
    await flush();
    view.quit();
    await pending;

    expect(view.monitorStates.at(-1)?.selectedNodeId).toBeNull();
    expect(view.monitorStates.at(-1)?.waitState).toEqual({ kind: "none" });
  });

  test("refresh updates displayed status and liveness in place and keeps selection anchored", async () => {
    const view = createViewHost();
    const refresh = createRefreshScheduler();
    const { deps } = entryDeps(
      {
        listResponses: [
          { runs: [RUN_ALPHA] },
          { runs: [{ ...RUN_ALPHA, status: "completed", isLive: false, finishedAtMs: TERMINAL_LIST_FINISH_MS }] },
        ],
        waitImpl: async () => ({ runStatus: "completed" }),
      },
      { viewHost: view.host, refreshScheduler: refresh.scheduler },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    refresh.tick();
    await flush();
    view.quit();
    await pending;

    expect(view.monitorStates.at(-1)?.runs).toEqual([
      { ...RUN_ALPHA, status: "completed", isLive: false, finishedAtMs: TERMINAL_LIST_FINISH_MS },
    ]);
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe("run-alpha");
  });

  test("refresh clears selection and abandons a pending wait when the selected run disappears", async () => {
    const view = createViewHost();
    const refresh = createRefreshScheduler();
    const alphaWait = deferred<WaitRunCompletionResult>();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_ALPHA] }, { runs: [RUN_BETA] }],
        waitImpl: async () => alphaWait.promise,
      },
      { viewHost: view.host, refreshScheduler: refresh.scheduler },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    refresh.tick();
    await flush();
    alphaWait.resolve({ runStatus: "completed", loopOutcomeKind: "complete" });
    await flush();
    view.quit();
    await pending;

    expect(clientOptions.methods).toEqual([
      "health",
      "status",
      "list",
      "pipeline_list",
      "wait:run-alpha",
      "list",
      "pipeline_list",
      "close",
    ]);
    expect(view.monitorStates.at(-1)).toEqual({
      runs: [RUN_BETA],
      selectedNodeId: null,
      waitState: { kind: "none" },
      steeringFeedback: null,
      expandedPipelineNodeIds: [],
      refreshIntervalLabel: "1s",
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [] } },
    });
  });

  test("selecting a quiescent run waits for that run and shows only present optional outcome fields", async () => {
    const view = createViewHost();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_ALPHA, RUN_BETA] }],
        waitImpl: async (runId) =>
          runId === "run-alpha" ? { runStatus: "completed" } : { runStatus: "blocked", iterationsConsumed: 3 },
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    view.selectNode("run-beta");
    await flush();
    view.quit();
    await pending;

    const finalWaitState = view.monitorStates.at(-1)?.waitState;
    expect(clientOptions.methods).toEqual([
      "health",
      "status",
      "list",
      "pipeline_list",
      "wait:run-alpha",
      "wait:run-beta",
      "close",
    ]);
    expect(view.monitorStates.at(-1)).toMatchObject({
      selectedNodeId: "run-beta",
      waitState: {
        kind: "ready",
        runId: "run-beta",
        result: { runStatus: "blocked", iterationsConsumed: 3 },
      },
    });
    if (finalWaitState?.kind !== "ready") {
      throw new Error("expected ready wait state");
    }
    expect("loopOutcomeKind" in finalWaitState.result).toBe(false);
    expect("resumable" in finalWaitState.result).toBe(false);
  });

  test("changing selection while wait is pending abandons the prior wait and starts a fresh one", async () => {
    const view = createViewHost();
    const alphaWait = deferred<WaitRunCompletionResult>();
    const betaWait = deferred<WaitRunCompletionResult>();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_ALPHA, RUN_BETA] }],
        waitImpl: async (runId) => (runId === "run-alpha" ? alphaWait.promise : betaWait.promise),
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    view.selectNode("run-beta");
    await flush();
    betaWait.resolve({ runStatus: "completed" });
    await flush();
    view.quit();
    await pending;

    expect(clientOptions.methods).toEqual([
      "health",
      "status",
      "list",
      "pipeline_list",
      "wait:run-alpha",
      "wait:run-beta",
      "close",
    ]);
    expect(view.monitorStates.at(-2)?.waitState).toEqual({ kind: "pending", runId: "run-beta" });
    expect(view.monitorStates.at(-1)?.waitState).toEqual({
      kind: "ready",
      runId: "run-beta",
      result: { runStatus: "completed" },
    });
  });

  test("late replies from abandoned waits are ignored", async () => {
    const view = createViewHost();
    const alphaWait = deferred<WaitRunCompletionResult>();
    const betaWait = deferred<WaitRunCompletionResult>();
    const { deps } = entryDeps(
      {
        listResponses: [{ runs: [RUN_ALPHA, RUN_BETA] }],
        waitImpl: async (runId) => (runId === "run-alpha" ? alphaWait.promise : betaWait.promise),
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    view.selectNode("run-beta");
    await flush();
    betaWait.resolve({ runStatus: "blocked", loopOutcomeKind: "blocked" });
    await flush();
    alphaWait.resolve({ runStatus: "completed", loopOutcomeKind: "complete" });
    await flush();
    view.quit();
    await pending;

    expect(view.monitorStates.at(-1)?.waitState).toEqual({
      kind: "ready",
      runId: "run-beta",
      result: { runStatus: "blocked", loopOutcomeKind: "blocked" },
    });
  });

  test("initial health and status RPC errors pass through as rpc-error and exit 1", async () => {
    const view = createViewHost();

    const unhealthy = await runTuiEntry({
      socketPath: "/tmp/test.sock",
      viewHost: view.host,
      connectTuiDaemon: async () =>
        fakeClient({
          healthError: new RpcError("unhealthy", "daemon not ready"),
        }),
    });

    const unavailableStatus = await runTuiEntry({
      socketPath: "/tmp/test.sock",
      viewHost: view.host,
      connectTuiDaemon: async () =>
        fakeClient({
          statusError: new RpcError("status_unavailable", "no status"),
        }),
    });

    expect(unhealthy).toBe(1);
    expect(unavailableStatus).toBe(1);
    expect(view.feedbackStates).toEqual([
      { kind: "rpc-error", code: "unhealthy", message: "daemon not ready" },
      { kind: "rpc-error", code: "status_unavailable", message: "no status" },
    ]);
  });

  test("post-proof initial list failure shows rpc-error not unavailable feedback", async () => {
    const view = createViewHost();

    const code = await runTuiEntry({
      socketPath: "/tmp/test.sock",
      viewHost: view.host,
      connectTuiDaemon: async () =>
        fakeClient({
          listError: new RpcConnectionError("malformed RPC reply: invalid list result"),
        }),
    });

    expect(code).toBe(1);
    expect(view.feedbackStates).toEqual([
      {
        kind: "rpc-error",
        code: "daemon_error",
        message: "malformed RPC reply: invalid list result",
      },
    ]);
  });

  test("refresh preserves selection changed while list is in flight", async () => {
    const view = createViewHost();
    const refresh = createRefreshScheduler();
    const refreshList = deferred<DaemonListResult>();
    let listCalls = 0;

    const client: TuiDaemonClient = {
      async health() {
        return { ok: true };
      },
      async status() {
        return { state: "running" };
      },
      async list() {
        listCalls += 1;
        if (listCalls === 1) {
          return { runs: [RUN_ALPHA, RUN_BETA] };
        }
        return refreshList.promise;
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
      async wait(runId) {
        return runId === "run-alpha" ? { runStatus: "completed" } : { runStatus: "blocked", iterationsConsumed: 3 };
      },
      close() {},
    };

    const pending = runTuiEntry({
      socketPath: "/tmp/test.sock",
      viewHost: view.host,
      refreshScheduler: refresh.scheduler,
      connectTuiDaemon: async () => client,
      socketDiscovery: async () => [],
    });
    await view.waitUntilOpen();
    await flush();
    await flush();

    refresh.tick();
    await flush();
    view.selectNode("run-beta");
    await flush();
    await flush();
    refreshList.resolve({ runs: [RUN_BETA] });
    await flush();
    await flush();
    await flush();

    expect(view.monitorStates.at(-1)).toMatchObject({
      runs: [RUN_BETA],
      selectedNodeId: "run-beta",
    });

    view.quit();
    await pending;
  });

  test("wait failure with unchanged selection shows error state not perpetual pending", async () => {
    const view = createViewHost();
    const alphaWait = deferred<WaitRunCompletionResult>();
    const { deps } = entryDeps(
      {
        listResponses: [{ runs: [RUN_ALPHA] }],
        waitImpl: async () => alphaWait.promise,
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    expect(view.monitorStates.at(-1)?.waitState).toEqual({ kind: "pending", runId: "run-alpha" });

    alphaWait.reject(new RpcError("unknown_run", "run not found"));
    await flush();

    expect(view.monitorStates.at(-1)?.waitState).toEqual({ kind: "error", runId: "run-alpha" });

    view.quit();
    await pending;
  });

  test("steering sends pause, resume, and kill for the selected run and keeps the monitor open", async () => {
    const view = createViewHost();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_ALPHA, RUN_BETA, RUN_GAMMA] }],
        waitImpl: async () => ({ runStatus: "completed" }),
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    view.selectNode("run-gamma");
    await flush();
    view.pauseSelected();
    await flush();
    view.resumeSelected();
    await flush();
    view.killSelected();
    await flush();
    view.quit();
    const code = await pending;

    expect(code).toBe(0);
    const methods = clientOptions.methods ?? [];
    expect(methods).toContain("pause:run-gamma");
    expect(methods).toContain("resume:run-gamma");
    expect(methods).toContain("kill:run-gamma");
  });

  test("steering RPC errors render inline and keep the monitor open", async () => {
    const cases = [
      { action: "pauseSelected" as const, error: new RpcError("run_not_active", "not active") },
      { action: "resumeSelected" as const, error: new RpcError("terminal_run", "terminal") },
    ];

    for (const { action, error } of cases) {
      const view = createViewHost();
      const errorKey = action === "pauseSelected" ? "pauseError" : "resumeError";
      const { deps } = entryDeps(
        {
          listResponses: [{ runs: [RUN_ALPHA] }],
          waitImpl: async () => ({ runStatus: "completed" }),
          [errorKey]: error,
        },
        { viewHost: view.host },
      );

      const pending = runTuiEntry(deps);
      await view.waitUntilOpen();
      await flush();
      view[action]();
      await flush();
      expect(view.monitorStates.at(-1)?.steeringFeedback).toBe(`${error.code}: ${error.message}`);
      view.quit();
      expect(await pending).toBe(0);
    }
  });

  test("steering connection errors render inline as daemon_error and keep the monitor open", async () => {
    const view = createViewHost();
    const { deps } = entryDeps(
      {
        listResponses: [{ runs: [RUN_ALPHA] }],
        waitImpl: async () => ({ runStatus: "completed" }),
        killError: new RpcConnectionError("socket closed"),
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    view.killSelected();
    await flush();

    expect(view.monitorStates.at(-1)?.steeringFeedback).toBe("daemon_error: socket closed");

    view.quit();
    expect(await pending).toBe(0);
  });

  test("steering with no selected run is a no-op and shows no run selected", async () => {
    const view = createViewHost();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [] }],
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    view.pauseSelected();
    await flush();

    expect(clientOptions.methods).toEqual(["health", "status", "list", "pipeline_list"]);
    expect(view.monitorStates.at(-1)?.steeringFeedback).toBe("no run selected");

    view.quit();
    await pending;
  });

  test("multi-daemon: two daemons returning the same durable rows render each run once", async () => {
    const view = createViewHost();
    const client1Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [RUN_ALPHA, RUN_BETA] }],
    };
    const client2Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [RUN_ALPHA, RUN_BETA] }],
    };
    const client3Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [] }],
    };

    const clients = [fakeClient(client1Options), fakeClient(client2Options), fakeClient(client3Options)];
    let clientIndex = 0;

    const { deps } = entryDeps(
      {},
      {
        viewHost: view.host,
        connectTuiDaemon: async () => {
          const c = clients[clientIndex++];
          return c as TuiDaemonClient;
        },
        socketDiscovery: async () => ["/tmp/daemon1.sock", "/tmp/daemon2.sock"],
      },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    view.quit();
    await pending;

    const finalRuns = view.monitorStates.at(-1)?.runs ?? [];
    expect(finalRuns.length).toBe(2);
    expect(finalRuns.map((r) => r.runId)).toEqual(["run-alpha", "run-beta"]);
  });

  test("multi-daemon: a run live on the second daemon is owned and steered there", async () => {
    const view = createViewHost();
    const client1Options: FakeClientOptions = {
      methods: [],
      listResponses: [
        {
          runs: [
            { ...RUN_ALPHA, isLive: false },
            { ...RUN_BETA, isLive: false },
          ],
        },
      ],
      pauseError: new RpcError("run_not_active", "not active on daemon1"),
    };
    const client2Options: FakeClientOptions = {
      methods: [],
      listResponses: [
        {
          runs: [
            { ...RUN_ALPHA, isLive: true },
            { ...RUN_BETA, isLive: false },
          ],
        },
      ],
    };
    const client3Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [] }],
    };

    const clients = [fakeClient(client1Options), fakeClient(client2Options), fakeClient(client3Options)];
    let clientIndex = 0;

    const { deps } = entryDeps(
      {},
      {
        viewHost: view.host,
        connectTuiDaemon: async () => {
          const c = clients[clientIndex++];
          return c as TuiDaemonClient;
        },
        socketDiscovery: async () => ["/tmp/daemon1.sock", "/tmp/daemon2.sock"],
      },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    view.selectNode("run-alpha");
    await flush();
    view.pauseSelected();
    await flush();
    view.quit();
    await pending;

    // Pause should route to daemon2 (the owner), not daemon1
    expect(client1Options.methods).not.toContain("pause:run-alpha");
    expect(client2Options.methods).toContain("pause:run-alpha");
  });

  test("multi-daemon: runs live on different daemons are visible together in one monitor", async () => {
    const view = createViewHost();
    const client1Options: FakeClientOptions = {
      methods: [],
      listResponses: [
        {
          runs: [
            { ...RUN_ALPHA, isLive: true },
            { ...RUN_BETA, isLive: false },
          ],
        },
      ],
    };
    const client2Options: FakeClientOptions = {
      methods: [],
      listResponses: [
        {
          runs: [
            { ...RUN_ALPHA, isLive: false },
            { ...RUN_BETA, isLive: false },
            { ...RUN_GAMMA, isLive: true },
          ],
        },
      ],
    };
    const client3Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [] }],
    };

    const clients = [fakeClient(client1Options), fakeClient(client2Options), fakeClient(client3Options)];
    let clientIndex = 0;

    const { deps } = entryDeps(
      {},
      {
        viewHost: view.host,
        connectTuiDaemon: async () => {
          const c = clients[clientIndex++];
          return c as TuiDaemonClient;
        },
        socketDiscovery: async () => ["/tmp/daemon1.sock", "/tmp/daemon2.sock"],
      },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    view.quit();
    await pending;

    const finalRuns = view.monitorStates.at(-1)?.runs ?? [];
    const runIds = finalRuns.map((r) => r.runId);
    expect(runIds).toContain("run-alpha");
    expect(runIds).toContain("run-gamma");
  });

  test("multi-daemon: a connection whose list fails leaves the remaining daemons rendered and the monitor open", async () => {
    const view = createViewHost();
    const client1Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [RUN_ALPHA, RUN_BETA] }],
    };
    const client2Options: FakeClientOptions = {
      methods: [],
      listError: new Error("connection reset"),
    };
    const client3Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [] }],
    };

    const clients = [fakeClient(client1Options), fakeClient(client2Options), fakeClient(client3Options)];
    let clientIndex = 0;

    const { deps } = entryDeps(
      {},
      {
        viewHost: view.host,
        connectTuiDaemon: async () => {
          const c = clients[clientIndex++];
          return c as TuiDaemonClient;
        },
        socketDiscovery: async () => ["/tmp/daemon1.sock", "/tmp/daemon2.sock"],
      },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    view.quit();
    await pending;

    const finalRuns = view.monitorStates.at(-1)?.runs ?? [];
    expect(finalRuns.length).toBe(2);
    expect(finalRuns.map((r) => r.runId)).toEqual(["run-alpha", "run-beta"]);
  });

  test("multi-daemon: with discovery returning no sockets, the TUI still connects to the invoking digest socket and behaves as before", async () => {
    const view = createViewHost();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_ALPHA] }],
        waitImpl: async () => ({ runStatus: "completed" }),
      },
      {
        viewHost: view.host,
        socketDiscovery: async () => [],
      },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    view.quit();

    const code = await pending;

    expect(code).toBe(0);
    expect(clientOptions.methods).toEqual(["health", "status", "list", "pipeline_list", "wait:run-alpha", "close"]);
    expect(view.monitorStates[0]).toMatchObject({
      runs: [RUN_ALPHA],
      selectedNodeId: "run-alpha",
    });
  });

  test("multi-daemon guard: dedupe-by-run-ID prevents duplicate rows when both daemons return the same run", async () => {
    const view = createViewHost();
    const client1Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [RUN_ALPHA] }],
    };
    const client2Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [RUN_ALPHA] }],
    };
    const client3Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [] }],
    };

    const clients = [fakeClient(client1Options), fakeClient(client2Options), fakeClient(client3Options)];
    let clientIndex = 0;

    const { deps } = entryDeps(
      {},
      {
        viewHost: view.host,
        connectTuiDaemon: async () => {
          const c = clients[clientIndex++];
          return c as TuiDaemonClient;
        },
        socketDiscovery: async () => ["/tmp/daemon1.sock", "/tmp/daemon2.sock"],
      },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    view.quit();
    await pending;

    const finalRuns = view.monitorStates.at(-1)?.runs ?? [];
    const alphaRuns = finalRuns.filter((r) => r.runId === "run-alpha");
    expect(alphaRuns.length).toBe(1);
  });

  test("multi-daemon guard: live-owner preference assigns ownership to the daemon reporting isLive", async () => {
    const view = createViewHost();
    const client1Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [{ ...RUN_ALPHA, isLive: false }] }],
    };
    const client2Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [{ ...RUN_ALPHA, isLive: true }] }],
    };
    const client3Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [] }],
    };

    const clients = [fakeClient(client1Options), fakeClient(client2Options), fakeClient(client3Options)];
    let clientIndex = 0;

    const { deps } = entryDeps(
      {},
      {
        viewHost: view.host,
        connectTuiDaemon: async () => {
          const c = clients[clientIndex++];
          return c as TuiDaemonClient;
        },
        socketDiscovery: async () => ["/tmp/daemon1.sock", "/tmp/daemon2.sock"],
      },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();

    const finalRuns = view.monitorStates.at(-1)?.runs ?? [];
    const alphaRun = finalRuns.find((r) => r.runId === "run-alpha");
    expect(alphaRun?.isLive).toBe(true);

    view.quit();
    await pending;
  });

  test("multi-daemon guard: per-connection failure skip does not render empty when second daemon fails", async () => {
    const view = createViewHost();
    const client1Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [RUN_ALPHA] }],
    };
    const client2Options: FakeClientOptions = {
      methods: [],
      listError: new RpcConnectionError("connection lost"),
    };
    const client3Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [] }],
    };

    const clients = [fakeClient(client1Options), fakeClient(client2Options), fakeClient(client3Options)];
    let clientIndex = 0;

    const { deps } = entryDeps(
      {},
      {
        viewHost: view.host,
        connectTuiDaemon: async () => {
          const c = clients[clientIndex++];
          return c as TuiDaemonClient;
        },
        socketDiscovery: async () => ["/tmp/daemon1.sock", "/tmp/daemon2.sock"],
      },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    view.quit();
    await pending;

    const finalRuns = view.monitorStates.at(-1)?.runs ?? [];
    expect(finalRuns.length).toBeGreaterThan(0);
    expect(finalRuns.some((r) => r.runId === "run-alpha")).toBe(true);
  });

  test("steering feedback replaces on the next action and clears on selection change", async () => {
    const view = createViewHost();
    const { deps } = entryDeps(
      {
        listResponses: [{ runs: [RUN_ALPHA, RUN_BETA] }],
        waitImpl: async () => ({ runStatus: "completed" }),
        pauseError: new RpcError("run_not_active", "not active"),
        killError: new RpcError("unknown_run", "missing"),
      },
      { viewHost: view.host },
    );

    const _pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    view.pauseSelected();
    await flush();
    expect(view.monitorStates.at(-1)?.steeringFeedback).toBe("run_not_active: not active");

    view.killSelected();
    await flush();
    expect(view.monitorStates.at(-1)?.steeringFeedback).toBe("unknown_run: missing");

    view.selectNode("run-beta");
    await flush();
    expect(view.monitorStates.at(-1)?.steeringFeedback).toBeNull();
  });

  test("waitState error display is unchanged by steering feedback", async () => {
    const view = createViewHost();
    const alphaWait = deferred<WaitRunCompletionResult>();
    const { deps } = entryDeps(
      {
        listResponses: [{ runs: [RUN_ALPHA] }],
        waitImpl: async () => alphaWait.promise,
        pauseError: new RpcError("run_not_active", "not active"),
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    alphaWait.reject(new RpcError("unknown_run", "run not found"));
    await flush();
    expect(view.monitorStates.at(-1)?.waitState).toEqual({ kind: "error", runId: "run-alpha" });

    view.pauseSelected();
    await flush();
    expect(view.monitorStates.at(-1)?.waitState).toEqual({ kind: "error", runId: "run-alpha" });
    expect(view.monitorStates.at(-1)?.steeringFeedback).toBe("run_not_active: not active");

    view.quit();
    await pending;
  });

  test("successful pause does not re-issue wait or mutate waitState", async () => {
    const view = createViewHost();
    const pauseWait = deferred<WaitRunCompletionResult>();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_ALPHA] }],
        waitImpl: async () => pauseWait.promise,
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    pauseWait.resolve({ runStatus: "completed" });
    await flush();
    expect(view.monitorStates.at(-1)?.waitState?.kind).toBe("ready");
    const readyWaitState = view.monitorStates.at(-1)?.waitState;
    const waitCount = clientOptions.methods?.filter((method) => method === "wait:run-alpha").length ?? 0;

    view.pauseSelected();
    await flush();

    expect(view.monitorStates.at(-1)?.waitState).toEqual(readyWaitState);
    expect(clientOptions.methods?.filter((method) => method === "wait:run-alpha").length).toBe(waitCount);
    expect(clientOptions.methods).toContain("pause:run-alpha");
    view.quit();
    await pending;
  });

  test("steering on terminal or non-live rows passes through to daemon without client pre-gate", async () => {
    const cases = [
      { row: RUN_BETA, action: "pauseSelected" as const, errorKey: "pauseError" as const },
      { row: RUN_GAMMA, action: "killSelected" as const, errorKey: "killError" as const },
    ];

    for (const { row, action, errorKey } of cases) {
      const view = createViewHost();
      const error = new RpcError("run_not_active", "not active");
      const { deps, clientOptions } = entryDeps(
        {
          methods: [],
          listResponses: [{ runs: [RUN_ALPHA, row] }],
          waitImpl: async () => ({ runStatus: "completed" }),
          [errorKey]: error,
        },
        { viewHost: view.host },
      );

      const pending = runTuiEntry(deps);
      await view.waitUntilOpen();
      await flush();
      view.selectNode(row.runId);
      await flush();
      view[action]();
      await flush();

      const rpcMethod = action === "pauseSelected" ? "pause" : "kill";
      expect(clientOptions.methods).toContain(`${rpcMethod}:${row.runId}`);
      expect(view.monitorStates.at(-1)?.steeringFeedback).toBe(`${error.code}: ${error.message}`);

      view.quit();
      expect(await pending).toBe(0);
    }
  });

  test("successful resume re-issues wait and abandons a prior ready snapshot", async () => {
    const view = createViewHost();
    const waitQueue: Array<ReturnType<typeof deferred<WaitRunCompletionResult>>> = [];
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_ALPHA] }],
        waitImpl: async () => {
          const pending = deferred<WaitRunCompletionResult>();
          waitQueue.push(pending);
          return pending.promise;
        },
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    waitQueue[0]?.resolve({ runStatus: "completed", loopOutcomeKind: "complete" });
    await flush();
    expect(view.monitorStates.at(-1)?.waitState).toMatchObject({ kind: "ready", runId: "run-alpha" });

    view.resumeSelected();
    await flush();
    expect(view.monitorStates.at(-1)?.waitState).toEqual({ kind: "pending", runId: "run-alpha" });
    expect(clientOptions.methods).toContain("resume:run-alpha");
    expect(clientOptions.methods?.filter((method) => method === "wait:run-alpha").length).toBe(2);

    waitQueue[1]?.resolve({ runStatus: "in-progress" });
    await flush();
    await flush();
    expect(view.monitorStates.at(-1)?.waitState).toMatchObject({
      kind: "ready",
      runId: "run-alpha",
      result: { runStatus: "in-progress" },
    });

    view.quit();
    await pending;
  });

  test("rediscovery: a socket appearing after startup contributes runs on the next tick", async () => {
    const view = createViewHost();
    const refresh = createRefreshScheduler();
    let discoveryCallCount = 0;

    const mainDaemonOptions: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [RUN_ALPHA] }, { runs: [RUN_ALPHA] }],
    };
    const newDaemonOptions: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [RUN_BETA] }],
    };

    const clients = [fakeClient(mainDaemonOptions), fakeClient(newDaemonOptions)];
    let clientIndex = 0;

    const { deps } = entryDeps(
      {},
      {
        viewHost: view.host,
        refreshScheduler: refresh.scheduler,
        connectTuiDaemon: async () => {
          const c = clients[clientIndex++];
          if (!c) throw new Error(`no client at index ${clientIndex - 1}`);
          return c;
        },
        socketDiscovery: async () => {
          discoveryCallCount += 1;
          if (discoveryCallCount === 1) {
            return [];
          }
          return ["/tmp/daemon2.sock"];
        },
      },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    await flush();
    const initialRuns = view.monitorStates.at(-1)?.runs.map((r) => r.runId);
    expect(initialRuns).toEqual(["run-alpha"]);

    refresh.tick();
    await flush();
    await flush();
    await flush();
    const afterRefreshRuns = view.monitorStates.at(-1)?.runs.map((r) => r.runId);
    expect(afterRefreshRuns).toEqual(["run-alpha", "run-beta"]);

    view.quit();
    await pending;
  });

  test("rediscovery: a daemon that exits removes its exclusive runs and keeps the monitor open", async () => {
    const view = createViewHost();
    const refresh = createRefreshScheduler();
    let discoveryPhase = 0;

    const daemon1Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [RUN_ALPHA] }, { runs: [RUN_ALPHA] }],
    };
    const daemon2Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [RUN_BETA] }],
    };

    const clients = [fakeClient(daemon1Options), fakeClient(daemon2Options)];
    let clientIndex = 0;

    const { deps } = entryDeps(
      {},
      {
        viewHost: view.host,
        refreshScheduler: refresh.scheduler,
        connectTuiDaemon: async () => {
          const c = clients[clientIndex++];
          if (!c) throw new Error(`no client at index ${clientIndex - 1}`);
          return c;
        },
        socketDiscovery: async () => {
          discoveryPhase += 1;
          if (discoveryPhase === 1) {
            return ["/tmp/daemon1.sock", "/tmp/daemon2.sock"];
          }
          return ["/tmp/daemon1.sock"];
        },
      },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    await flush();
    expect(view.monitorStates.at(-1)?.runs.map((r) => r.runId)).toEqual(["run-alpha", "run-beta"]);

    refresh.tick();
    await flush();
    await flush();
    await flush();
    expect(view.monitorStates.at(-1)?.runs.map((r) => r.runId)).toEqual(["run-alpha"]);

    view.quit();
    await pending;
  });

  test("rediscovery: superseded and superseding daemons render together while both are live", async () => {
    const view = createViewHost();
    const refresh = createRefreshScheduler();
    let discoveryPhase = 0;

    const daemon1Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [RUN_ALPHA] }, { runs: [RUN_ALPHA] }],
    };
    const daemon2Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [RUN_BETA] }],
    };

    const clients = [fakeClient(daemon1Options), fakeClient(daemon2Options)];
    let clientIndex = 0;

    const { deps } = entryDeps(
      {},
      {
        viewHost: view.host,
        refreshScheduler: refresh.scheduler,
        connectTuiDaemon: async () => {
          const c = clients[clientIndex++];
          if (!c) throw new Error(`no client at index ${clientIndex - 1}`);
          return c;
        },
        socketDiscovery: async () => {
          discoveryPhase += 1;
          if (discoveryPhase === 1) {
            return [];
          }
          return ["/tmp/daemon2.sock"];
        },
      },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    await flush();
    expect(view.monitorStates.at(-1)?.runs.map((r) => r.runId)).toEqual(["run-alpha"]);

    refresh.tick();
    await flush();
    await flush();
    await flush();
    const finalRuns = view.monitorStates.at(-1)?.runs.map((r) => r.runId);
    expect(finalRuns).toContain("run-alpha");
    expect(finalRuns).toContain("run-beta");

    view.quit();
    await pending;
  });

  test("rediscovery: selection clears when the owning daemon is dropped", async () => {
    const view = createViewHost();
    const refresh = createRefreshScheduler();
    let discoveryPhase = 0;

    const daemon1Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [RUN_ALPHA] }, { runs: [RUN_ALPHA] }],
    };
    const daemon2Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [RUN_BETA] }],
      waitImpl: async () => ({ runStatus: "completed" }),
    };

    const clients = [fakeClient(daemon1Options), fakeClient(daemon2Options)];
    let clientIndex = 0;

    const { deps } = entryDeps(
      {},
      {
        viewHost: view.host,
        refreshScheduler: refresh.scheduler,
        connectTuiDaemon: async () => {
          const c = clients[clientIndex++];
          if (!c) throw new Error(`no client at index ${clientIndex - 1}`);
          return c;
        },
        socketDiscovery: async () => {
          discoveryPhase += 1;
          if (discoveryPhase === 1) {
            return ["/tmp/daemon1.sock", "/tmp/daemon2.sock"];
          }
          return ["/tmp/daemon1.sock"];
        },
      },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    await flush();
    view.selectNode("run-beta");
    await flush();
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe("run-beta");

    refresh.tick();
    await flush();
    await flush();
    await flush();
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBeNull();
    expect(view.monitorStates.at(-1)?.waitState).toEqual({ kind: "none" });

    view.quit();
    await pending;
  });

  test("rediscovery: selection clears when the owning daemon drops a selected pipeline", async () => {
    const view = createViewHost();
    const refresh = createRefreshScheduler();
    let discoveryPhase = 0;

    const daemon1Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [RUN_ALPHA] }, { runs: [RUN_ALPHA] }],
      pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_ALPHA] }],
    };
    const daemon2Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [RUN_BETA] }, { runs: [RUN_BETA] }],
      pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_BETA] }],
    };

    const clients = [fakeClient(daemon1Options), fakeClient(daemon2Options)];
    let clientIndex = 0;

    const { deps } = entryDeps(
      {},
      {
        viewHost: view.host,
        refreshScheduler: refresh.scheduler,
        connectTuiDaemon: async () => {
          const c = clients[clientIndex++];
          if (!c) throw new Error(`no client at index ${clientIndex - 1}`);
          return c;
        },
        socketDiscovery: async () => {
          discoveryPhase += 1;
          if (discoveryPhase === 1) {
            return ["/tmp/daemon1.sock", "/tmp/daemon2.sock"];
          }
          return ["/tmp/daemon1.sock"];
        },
      },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    await flush();
    view.selectNode("pipe-beta");
    await flush();
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe("pipe-beta");

    refresh.tick();
    await flush();
    await flush();
    await flush();
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBeNull();
    expect(view.monitorStates.at(-1)?.waitState).toEqual({ kind: "none" });

    view.quit();
    await pending;
  });

  test("rediscovery: steering targets the daemon owning the selected run after supersession", async () => {
    const view = createViewHost();
    const refresh = createRefreshScheduler();
    let discoveryPhase = 0;

    const daemon1Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [{ ...RUN_ALPHA, isLive: false }] }, { runs: [{ ...RUN_ALPHA, isLive: false }] }],
      pauseError: new RpcError("run_not_active", "not active on daemon1"),
    };
    const daemon2Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [{ ...RUN_ALPHA, isLive: true }] }],
    };

    const clients = [fakeClient(daemon1Options), fakeClient(daemon2Options)];
    let clientIndex = 0;

    const { deps } = entryDeps(
      {},
      {
        viewHost: view.host,
        refreshScheduler: refresh.scheduler,
        connectTuiDaemon: async () => {
          const c = clients[clientIndex++];
          if (!c) throw new Error(`no client at index ${clientIndex - 1}`);
          return c;
        },
        socketDiscovery: async () => {
          discoveryPhase += 1;
          if (discoveryPhase === 1) {
            return [];
          }
          return ["/tmp/daemon2.sock"];
        },
      },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    await flush();
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe("run-alpha");

    refresh.tick();
    await flush();
    await flush();
    await flush();
    view.pauseSelected();
    await flush();

    // Pause should route to daemon2 (the live owner), not daemon1
    expect(daemon1Options.methods).not.toContain("pause:run-alpha");
    expect(daemon2Options.methods).toContain("pause:run-alpha");

    view.quit();
    await pending;
  });

  test("rediscovery: a rediscovery that fails leaves previously connected daemons rendered", async () => {
    const view = createViewHost();
    const refresh = createRefreshScheduler();
    let discoveryPhase = 0;

    const mainDaemonOptions: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [RUN_ALPHA] }, { runs: [RUN_ALPHA] }],
    };

    const clients = [fakeClient(mainDaemonOptions)];
    let clientIndex = 0;

    const { deps } = entryDeps(
      {},
      {
        viewHost: view.host,
        refreshScheduler: refresh.scheduler,
        connectTuiDaemon: async () => {
          const c = clients[clientIndex++];
          if (!c) throw new Error(`no client at index ${clientIndex - 1}`);
          return c;
        },
        socketDiscovery: async () => {
          discoveryPhase += 1;
          if (discoveryPhase === 2) {
            throw new Error("discovery failed");
          }
          return [];
        },
      },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    await flush();
    expect(view.monitorStates.at(-1)?.runs.map((r) => r.runId)).toEqual(["run-alpha"]);

    refresh.tick();
    await flush();
    await flush();
    await flush();
    expect(view.monitorStates.at(-1)?.runs.map((r) => r.runId)).toEqual(["run-alpha"]);

    view.quit();
    await pending;
  });

  test("rediscovery: invoking socket list failure evicts stale client and reconnects", async () => {
    const view = createViewHost();
    const refresh = createRefreshScheduler();

    const invokingClient1 = fakeClient({ listResponses: [{ runs: [RUN_ALPHA] }] });
    let listCallCount = 0;
    const succeedOnce = invokingClient1.list.bind(invokingClient1);
    invokingClient1.list = async () => {
      listCallCount += 1;
      if (listCallCount === 1) return succeedOnce();
      throw new Error("connection reset");
    };

    const invokingClient2 = fakeClient({ listResponses: [{ runs: [RUN_BETA] }] });

    const clients: TuiDaemonClient[] = [invokingClient1, invokingClient2];
    let clientIndex = 0;

    const { deps } = entryDeps(
      {},
      {
        viewHost: view.host,
        refreshScheduler: refresh.scheduler,
        connectTuiDaemon: async () => {
          const c = clients[clientIndex++];
          if (!c) throw new Error(`no client at index ${clientIndex - 1}`);
          return c;
        },
        socketDiscovery: async () => {
          return [];
        },
      },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    await flush();
    const initialState = view.monitorStates.at(-1);
    if (!initialState) throw new Error("initialState is undefined");
    const initialLines = monitorTextLines(initialState);
    expect(initialLines.some((line) => line.includes("run-alpha"))).toBe(true);

    // First refresh: invoking client list() fails, triggering eviction
    refresh.tick();
    await flush();
    await flush();
    await flush();
    const afterFailureState = view.monitorStates.at(-1);
    expect(afterFailureState?.runs.length).toBe(0);

    // Second refresh: new invoking client connects and succeeds
    refresh.tick();
    await flush();
    await flush();
    await flush();
    const finalState = view.monitorStates.at(-1);
    if (!finalState) throw new Error("finalState is undefined");
    const finalLines = monitorTextLines(finalState);
    expect(finalLines.some((line) => line.includes("run-beta"))).toBe(true);

    view.quit();
    await pending;
  });

  test("initial refresh polls pipeline_list once per connected daemon before openMonitor", async () => {
    const view = createViewHost();
    const client1Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [RUN_ALPHA] }],
      pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_ALPHA] }],
    };
    const client2Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [RUN_BETA] }],
      pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_BETA] }],
    };
    const { deps } = dualDaemonEntryDeps(client1Options, client2Options, { viewHost: view.host });

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();

    expect(countRpcMethod(client1Options.methods, "list")).toBe(1);
    expect(countRpcMethod(client2Options.methods, "list")).toBe(1);
    expect(countRpcMethod(client1Options.methods, "pipeline_list")).toBe(1);
    expect(countRpcMethod(client2Options.methods, "pipeline_list")).toBe(1);

    const opened = view.monitorStates[0];
    expect(opened?.pipelineSnapshotsBySocketPath?.[DAEMON1_SOCKET]).toEqual({
      pipelines: [PIPELINE_SNAPSHOT_ALPHA],
    });
    expect(opened?.pipelineSnapshotsBySocketPath?.[DAEMON2_SOCKET]).toEqual({
      pipelines: [PIPELINE_SNAPSHOT_BETA],
    });

    view.quit();
    await pending;
  });

  test("periodic refresh polls pipeline_list once per connected daemon alongside list", async () => {
    // Mutation checkpoint: skipping `pipeline_list` in the refreshRuns client loop in tui-entry.tsx
    // turns this test RED.
    const view = createViewHost();
    const refresh = createRefreshScheduler();
    const client1Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [RUN_ALPHA] }, { runs: [RUN_ALPHA] }],
      pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_ALPHA] }, { pipelines: [PIPELINE_SNAPSHOT_ALPHA] }],
    };
    const client2Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [RUN_BETA] }, { runs: [RUN_BETA] }],
      pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_BETA] }, { pipelines: [PIPELINE_SNAPSHOT_BETA] }],
    };
    const { deps } = dualDaemonEntryDeps(client1Options, client2Options, {
      viewHost: view.host,
      refreshScheduler: refresh.scheduler,
    });

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    await flush();
    await flushRefreshTick(refresh);

    expect(countRpcMethod(client1Options.methods, "list")).toBe(2);
    expect(countRpcMethod(client2Options.methods, "list")).toBe(2);
    expect(countRpcMethod(client1Options.methods, "pipeline_list")).toBe(2);
    expect(countRpcMethod(client2Options.methods, "pipeline_list")).toBe(2);

    view.quit();
    await pending;
  });

  test("pipeline_list updates monitor state when list rows are unchanged", async () => {
    const view = createViewHost();
    const refresh = createRefreshScheduler();

    const { deps } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_ALPHA] }, { runs: [RUN_ALPHA] }],
        pipelineListResponses: [{ pipelines: [] }, { pipelines: [PIPELINE_SNAPSHOT_ALPHA] }],
        waitImpl: async () => ({ runStatus: "completed" }),
      },
      {
        viewHost: view.host,
        refreshScheduler: refresh.scheduler,
      },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    expect(view.monitorStates.at(-1)?.pipelineSnapshotsBySocketPath?.["/tmp/test.sock"]).toEqual({ pipelines: [] });

    await flushRefreshTick(refresh);

    expect(view.monitorStates.at(-1)?.runs).toEqual([RUN_ALPHA]);
    expect(view.monitorStates.at(-1)?.pipelineSnapshotsBySocketPath?.["/tmp/test.sock"]).toEqual({
      pipelines: [PIPELINE_SNAPSHOT_ALPHA],
    });

    view.quit();
    await pending;
  });

  test("pipeline_list failure keeps the monitor open with merged run rows rendered", async () => {
    // Mutation checkpoint: evicting the client or closing the monitor on `pipeline_list` failure in
    // tui-entry.tsx turns this test RED.
    // Mutation checkpoint: clearing merged run rows when `pipeline_list` fails while `list` succeeds
    // in tui-entry.tsx turns this test RED.
    const view = createViewHost();
    const client1Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [RUN_ALPHA] }],
      pipelineListError: new RpcConnectionError("pipeline observation failed"),
    };
    const client2Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [RUN_BETA] }],
      pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_BETA] }],
    };
    const { deps } = dualDaemonEntryDeps(client1Options, client2Options, { viewHost: view.host });

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();

    const finalRuns = view.monitorStates.at(-1)?.runs ?? [];
    expect(finalRuns.map((run) => run.runId)).toEqual(["run-alpha", "run-beta"]);
    expect(view.monitorStates.length).toBeGreaterThan(0);

    view.quit();
    await pending;
  });

  test("pipeline_list failure retains the last-good per-daemon snapshot", async () => {
    // Mutation checkpoint: clearing per-daemon snapshots on `pipeline_list` failure in tui-entry.tsx
    // turns this test RED.
    const view = createViewHost();
    const refresh = createRefreshScheduler();
    let pipelineListCalls = 0;
    const client = fakeClient({
      methods: [],
      listResponses: [{ runs: [RUN_ALPHA] }, { runs: [RUN_ALPHA] }],
      pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_ALPHA] }],
      waitImpl: async () => ({ runStatus: "completed" }),
    });
    const succeedPipelineList = client.pipelineList.bind(client);
    client.pipelineList = async () => {
      pipelineListCalls += 1;
      if (pipelineListCalls === 1) return succeedPipelineList();
      throw new RpcConnectionError("pipeline observation failed");
    };

    const { deps } = entryDeps(
      {},
      {
        viewHost: view.host,
        refreshScheduler: refresh.scheduler,
        connectTuiDaemon: async () => client,
      },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    expect(view.monitorStates.at(-1)?.pipelineSnapshotsBySocketPath?.["/tmp/test.sock"]).toEqual({
      pipelines: [PIPELINE_SNAPSHOT_ALPHA],
    });

    await flushRefreshTick(refresh);

    expect(view.monitorStates.at(-1)?.pipelineSnapshotsBySocketPath?.["/tmp/test.sock"]).toEqual({
      pipelines: [PIPELINE_SNAPSHOT_ALPHA],
    });

    view.quit();
    await pending;
  });

  test("invoking-socket list failure evicts pipeline snapshots; non-evicting failures retain others", async () => {
    const view = createViewHost();
    const refresh = createRefreshScheduler();

    const client1Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [RUN_ALPHA] }, { runs: [RUN_ALPHA] }, { runs: [RUN_ALPHA] }, { runs: [RUN_ALPHA] }],
      pipelineListResponses: [
        { pipelines: [PIPELINE_SNAPSHOT_ALPHA] },
        { pipelines: [PIPELINE_SNAPSHOT_ALPHA] },
        { pipelines: [PIPELINE_SNAPSHOT_ALPHA] },
        { pipelines: [PIPELINE_SNAPSHOT_ALPHA] },
      ],
    };
    const client2Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [RUN_BETA] }, { runs: [RUN_BETA] }, { runs: [RUN_BETA] }, { runs: [RUN_BETA] }],
      pipelineListResponses: [
        { pipelines: [PIPELINE_SNAPSHOT_BETA] },
        { pipelines: [PIPELINE_SNAPSHOT_BETA] },
        { pipelines: [PIPELINE_SNAPSHOT_BETA] },
        { pipelines: [PIPELINE_SNAPSHOT_BETA] },
      ],
    };
    const client1 = fakeClient(client1Options);
    const client2 = fakeClient(client2Options);

    let client1ListCalls = 0;
    const client1List = client1.list.bind(client1);
    client1.list = async () => {
      client1ListCalls += 1;
      if (client1ListCalls === 4) throw new Error("connection reset");
      return client1List();
    };

    let client2PipelineListCalls = 0;
    const client2PipelineList = client2.pipelineList.bind(client2);
    client2.pipelineList = async () => {
      client2PipelineListCalls += 1;
      if (client2PipelineListCalls === 2) throw new RpcConnectionError("pipeline_list failed");
      return client2PipelineList();
    };

    let client2ListCalls = 0;
    const client2List = client2.list.bind(client2);
    client2.list = async () => {
      client2ListCalls += 1;
      if (client2ListCalls === 3) throw new RpcConnectionError("connection lost");
      return client2List();
    };

    const clients = [client1, client2];
    let clientIndex = 0;
    const { deps } = entryDeps(
      {},
      {
        viewHost: view.host,
        refreshScheduler: refresh.scheduler,
        socketPath: DAEMON1_SOCKET,
        connectTuiDaemon: async () => {
          const c = clients[clientIndex++];
          if (!c) throw new Error(`no client at index ${clientIndex - 1}`);
          return c;
        },
        socketDiscovery: async () => [DAEMON1_SOCKET, DAEMON2_SOCKET],
      },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    await flush();
    expect(view.monitorStates.at(-1)?.pipelineSnapshotsBySocketPath?.[DAEMON1_SOCKET]).toEqual({
      pipelines: [PIPELINE_SNAPSHOT_ALPHA],
    });
    expect(view.monitorStates.at(-1)?.pipelineSnapshotsBySocketPath?.[DAEMON2_SOCKET]).toEqual({
      pipelines: [PIPELINE_SNAPSHOT_BETA],
    });

    // Tick 1: pipeline_list fails on daemon2; daemon1 snapshot retained.
    await flushRefreshTick(refresh);
    expect(view.monitorStates.at(-1)?.pipelineSnapshotsBySocketPath?.[DAEMON1_SOCKET]).toEqual({
      pipelines: [PIPELINE_SNAPSHOT_ALPHA],
    });
    expect(view.monitorStates.at(-1)?.pipelineSnapshotsBySocketPath?.[DAEMON2_SOCKET]).toEqual({
      pipelines: [PIPELINE_SNAPSHOT_BETA],
    });

    // Tick 2: non-invoking list fails on daemon2; daemon1 snapshot retained.
    await flushRefreshTick(refresh);
    expect(view.monitorStates.at(-1)?.pipelineSnapshotsBySocketPath?.[DAEMON1_SOCKET]).toEqual({
      pipelines: [PIPELINE_SNAPSHOT_ALPHA],
    });
    expect(view.monitorStates.at(-1)?.pipelineSnapshotsBySocketPath?.[DAEMON2_SOCKET]).toEqual({
      pipelines: [PIPELINE_SNAPSHOT_BETA],
    });
    expect(client2Options.methods).toContain("pipeline_list");

    // Tick 3: invoking-socket list fails on daemon1; daemon1 snapshot evicted, daemon2 retained.
    await flushRefreshTick(refresh);
    expect(view.monitorStates.at(-1)?.pipelineSnapshotsBySocketPath?.[DAEMON1_SOCKET]).toBeUndefined();
    expect(view.monitorStates.at(-1)?.pipelineSnapshotsBySocketPath?.[DAEMON2_SOCKET]).toEqual({
      pipelines: [PIPELINE_SNAPSHOT_BETA],
    });

    view.quit();
    await pending;
  });

  test("non-invoking-socket list failure still issues pipeline_list on the same tick", async () => {
    const view = createViewHost();
    const client1Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [RUN_ALPHA] }],
      pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_ALPHA] }],
    };
    const client2Options: FakeClientOptions = {
      methods: [],
      listError: new RpcConnectionError("connection lost"),
      pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_BETA] }],
    };
    const { deps } = dualDaemonEntryDeps(client1Options, client2Options, { viewHost: view.host });

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();

    expect(client2Options.methods).toContain("pipeline_list");
    expect(view.monitorStates.at(-1)?.pipelineSnapshotsBySocketPath?.[DAEMON1_SOCKET]).toEqual({
      pipelines: [PIPELINE_SNAPSHOT_ALPHA],
    });
    expect(view.monitorStates.at(-1)?.pipelineSnapshotsBySocketPath?.[DAEMON2_SOCKET]).toEqual({
      pipelines: [PIPELINE_SNAPSHOT_BETA],
    });

    view.quit();
    await pending;
  });

  test("successful empty pipeline_list overwrites a prior non-empty snapshot", async () => {
    const view = createViewHost();
    const refresh = createRefreshScheduler();

    const { deps } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_ALPHA] }, { runs: [RUN_ALPHA] }],
        pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_ALPHA] }, { pipelines: [] }],
        waitImpl: async () => ({ runStatus: "completed" }),
      },
      {
        viewHost: view.host,
        refreshScheduler: refresh.scheduler,
      },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    expect(view.monitorStates.at(-1)?.pipelineSnapshotsBySocketPath?.["/tmp/test.sock"]).toEqual({
      pipelines: [PIPELINE_SNAPSHOT_ALPHA],
    });

    await flushRefreshTick(refresh);

    expect(view.monitorStates.at(-1)?.pipelineSnapshotsBySocketPath?.["/tmp/test.sock"]).toEqual({ pipelines: [] });

    view.quit();
    await pending;
  });
});
