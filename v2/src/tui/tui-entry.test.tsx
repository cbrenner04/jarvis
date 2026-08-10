import { describe, expect, spyOn, test } from "bun:test";
import { Writable } from "node:stream";
import { createElement, type ReactElement } from "react";
import type { PipelineStartAdmissionResult } from "../commands/pipeline-start-admission.ts";
import type { WaitRunCompletionResult } from "../daemon/daemon.ts";
import type { DaemonListResult, DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { PipelineApprovalDecisionOutcome, ResumePipelineOutcome } from "../daemon/pipeline-execution.ts";
import type { PipelineSnapshot } from "../daemon/pipeline-observation.ts";
import { RpcConnectionError, RpcError } from "../ipc/rpc-errors.ts";
import { buildAttentionRows } from "./tui-attention-rows.ts";
import * as tuiCommandParser from "./tui-command-parser.ts";
import type {
  PipelineListResult,
  PipelineResumeParams,
  PipelineStageMutationParams,
  TuiDaemonClient,
} from "./tui-daemon-client.ts";
import { TUI_DAEMON_SOCKET_DISPLAY } from "./tui-daemon-errors.ts";
import { formatElapsedWallClock } from "./tui-elapsed-format.ts";
import * as tuiEntry from "./tui-entry.tsx";
import {
  commandSubmissionBlockedByPendingAdmission,
  expansionCommandSelectionError,
  runTuiEntry,
  shouldApplyCommandSettlement,
} from "./tui-entry.tsx";
import type { InkRender } from "./tui-ink-feedback.tsx";
import type { InjectedInkUi, InkUseInput } from "./tui-ink-runtime.ts";
import {
  buildTreeRunRow,
  monitorDockLines,
  monitorLeftPaneTreeRows,
  monitorSelectableNodeIds,
  monitorTextLines,
} from "./tui-monitor-lines.ts";
import { buildPipelineMonitorTreeRow, monitorPipelineStageNodeId } from "./tui-monitor-pipeline-tree.ts";
import type {
  DetachedPipelineStartAdmission,
  RunTuiEntryDeps,
  TuiMonitorControls,
  TuiMonitorSession,
  TuiMonitorState,
  TuiViewHost,
  TuiViewState,
} from "./tui-monitor-types.ts";
import { computeShellLayout, monitorTreeRun } from "./tui-shell-layout.ts";

const TERMINAL_LIST_FINISH_MS = 9_000_000_000_000;

const noopDetachedAdmission: DetachedPipelineStartAdmission = async () => ({
  kind: "admitted",
  pipelineId: "test-pipeline",
});

const RUN_ALPHA: DaemonListRunRow = {
  runId: "run-alpha",
  project: "demo",
  branch: "alpha",
  createdAt: 0,
  status: "in-progress",
  isLive: true,
};

const RUN_BETA: DaemonListRunRow = {
  runId: "run-beta",
  project: "demo",
  branch: "beta",
  createdAt: 0,
  status: "completed",
  isLive: false,
  finishedAtMs: TERMINAL_LIST_FINISH_MS,
};

const RUN_GAMMA: DaemonListRunRow = {
  runId: "run-gamma",
  project: "demo",
  branch: "gamma",
  createdAt: 0,
  status: "blocked",
  isLive: false,
  finishedAtMs: TERMINAL_LIST_FINISH_MS,
};

const RUN_DELTA: DaemonListRunRow = {
  runId: "run-delta",
  project: "demo",
  branch: "delta",
  createdAt: 0,
  status: "paused",
  isLive: false,
};

const RUN_QUEUED: DaemonListRunRow = {
  runId: "run-queued",
  project: "demo",
  branch: "queued",
  createdAt: 0,
  status: "queued",
  isLive: false,
};

const PIPELINE_SNAPSHOT_ALPHA: PipelineSnapshot = {
  pipelineId: "pipe-alpha",
  name: "alpha-pipeline",
  state: "running",
  terminalPublicationSucceededAt: null,
  terminalPublicationFailure: null,
  createdAt: 1_700_000_000_000,
  finishedAtMs: null,
  stages: [
    {
      id: "stage-alpha-plan",
      stageId: "plan",
      branchKey: "default",
      position: 0,
      status: "running",
      workflowInvocationId: "inv-1",
      startedAt: null,
      endedAt: null,
      decidedAt: null,
      artifact: null,
      failureDetail: null,
    },
  ],
};

const PIPELINE_SNAPSHOT_BETA: PipelineSnapshot = {
  pipelineId: "pipe-beta",
  name: "beta-pipeline",
  state: "succeeded",
  terminalPublicationSucceededAt: null,
  terminalPublicationFailure: null,
  createdAt: 1_700_000_001_000,
  finishedAtMs: 1_700_000_002_000,
  stages: [
    {
      id: "stage-beta-s1",
      stageId: "s1",
      branchKey: "default",
      position: 0,
      status: "succeeded",
      workflowInvocationId: "inv-2",
      startedAt: null,
      endedAt: null,
      decidedAt: null,
      artifact: null,
      failureDetail: null,
    },
  ],
};

const PIPELINE_STAGE_ALPHA = monitorPipelineStageNodeId("pipe-alpha", "plan", "default");

const PIPELINE_AWAITING_INVOCATION = "inv-await";
const PIPELINE_SNAPSHOT_AWAITING: PipelineSnapshot = {
  pipelineId: "pipe-await",
  name: "await-pipeline",
  state: "awaiting-approval",
  terminalPublicationSucceededAt: null,
  terminalPublicationFailure: null,
  createdAt: 1_700_000_000_000,
  finishedAtMs: null,
  stages: [
    {
      id: "stage-await-gate",
      stageId: "gate",
      branchKey: "default",
      position: 0,
      status: "awaiting",
      workflowInvocationId: PIPELINE_AWAITING_INVOCATION,
      startedAt: null,
      endedAt: null,
      decidedAt: null,
      artifact: null,
      failureDetail: null,
    },
  ],
};
const PIPELINE_STAGE_AWAITING = monitorPipelineStageNodeId("pipe-await", "gate", "default");
const PIPELINE_RUN_AWAITING: DaemonListRunRow = {
  runId: "run-await",
  project: "demo",
  branch: "main",
  createdAt: 0,
  status: "in-progress",
  isLive: true,
  workflow: {
    invocationId: PIPELINE_AWAITING_INVOCATION,
    steps: [{ stepId: "gate", role: "actuator", status: "in_progress", attemptCount: 1 }],
  },
};

const PIPELINE_SNAPSHOT_ATTENTION_GATES: PipelineSnapshot = {
  pipelineId: "pipe-attn-gates",
  name: "full-review",
  state: "awaiting-approval",
  terminalPublicationSucceededAt: null,
  terminalPublicationFailure: null,
  createdAt: 1_700_000_000_000,
  finishedAtMs: null,
  stages: [
    {
      id: "stage-attn-intent",
      stageId: "intent",
      branchKey: "default",
      position: 0,
      status: "succeeded",
      workflowInvocationId: null,
      startedAt: null,
      endedAt: 100,
      decidedAt: null,
      artifact: null,
      failureDetail: null,
    },
    {
      id: "stage-attn-approve-intent",
      stageId: "approve-intent",
      branchKey: "default",
      position: 1,
      status: "rejected",
      workflowInvocationId: null,
      startedAt: null,
      endedAt: null,
      decidedAt: 1_500,
      artifact: null,
      failureDetail: null,
    },
    {
      id: "stage-attn-plan",
      stageId: "plan",
      branchKey: "default",
      position: 2,
      status: "failed",
      workflowInvocationId: null,
      startedAt: null,
      endedAt: 2_000,
      decidedAt: null,
      artifact: null,
      failureDetail: null,
    },
    {
      id: "stage-attn-approve-plan",
      stageId: "approve-plan",
      branchKey: "default",
      position: 3,
      status: "awaiting",
      workflowInvocationId: null,
      startedAt: null,
      endedAt: null,
      decidedAt: null,
      artifact: null,
      failureDetail: null,
    },
  ],
};

const PIPELINE_SNAPSHOT_ATTENTION_PUBLISHED: PipelineSnapshot = {
  pipelineId: "pipe-attn-published",
  name: "full-review",
  state: "succeeded",
  terminalAction: "merge",
  terminalPublicationSucceededAt: null,
  terminalPublicationFailure: { terminalAction: "merge", failure: { operation: "merge", message: "conflict" } },
  createdAt: 1_700_000_000_000,
  finishedAtMs: 1_700_000_003_000,
  stages: [
    {
      id: "stage-attn-published-intent",
      stageId: "intent",
      branchKey: "default",
      position: 0,
      status: "succeeded",
      workflowInvocationId: null,
      startedAt: null,
      endedAt: 3_000,
      decidedAt: null,
      artifact: null,
      failureDetail: null,
    },
    {
      id: "stage-attn-published-approve-intent",
      stageId: "approve-intent",
      branchKey: "default",
      position: 1,
      status: "approved",
      workflowInvocationId: null,
      startedAt: null,
      endedAt: null,
      decidedAt: 3_100,
      artifact: null,
      failureDetail: null,
    },
    {
      id: "stage-attn-published-plan",
      stageId: "plan",
      branchKey: "default",
      position: 2,
      status: "succeeded",
      workflowInvocationId: null,
      startedAt: null,
      endedAt: 3_200,
      decidedAt: null,
      artifact: null,
      failureDetail: null,
    },
    {
      id: "stage-attn-published-approve-plan",
      stageId: "approve-plan",
      branchKey: "default",
      position: 3,
      status: "approved",
      workflowInvocationId: null,
      startedAt: null,
      endedAt: null,
      decidedAt: 3_300,
      artifact: null,
      failureDetail: null,
    },
    {
      id: "stage-attn-published-implement",
      stageId: "implement",
      branchKey: "default",
      position: 4,
      status: "succeeded",
      workflowInvocationId: null,
      startedAt: null,
      endedAt: 3_400,
      decidedAt: null,
      artifact: null,
      failureDetail: null,
    },
  ],
};

const ATTENTION_FAILED_RUN: DaemonListRunRow = {
  runId: "run-attn-failed",
  project: "demo",
  branch: "attn-failed",
  createdAt: 0,
  status: "failed",
  isLive: false,
  finishedAtMs: TERMINAL_LIST_FINISH_MS,
};

const ATTENTION_BLOCKED_RUN: DaemonListRunRow = {
  runId: "run-attn-blocked",
  project: "demo",
  branch: "attn-blocked",
  createdAt: 0,
  status: "blocked",
  isLive: false,
  finishedAtMs: TERMINAL_LIST_FINISH_MS,
};

function attentionRunsFixture(): DaemonListRunRow[] {
  return [ATTENTION_FAILED_RUN, ATTENTION_BLOCKED_RUN];
}

function attentionRowIdByKind(
  state: TuiMonitorState | undefined,
  kind: "awaiting-gate" | "rejected-gate" | "failed-stage" | "failed-run" | "blocked-run" | "publication-failure",
): string {
  if (state === undefined) throw new Error("expected a painted monitor state");
  const projection = buildAttentionRows(state.pipelineSnapshotsBySocketPath, state.runs);
  const row = projection.rows.find((entry) => entry.kind === kind);
  if (row === undefined) throw new Error(`expected an attention row of kind ${kind}`);
  return row.id;
}

const PIPELINE_MULTI_INVOCATION = "inv-multi";
const PIPELINE_MULTI_STEPS = [
  { stepId: "implement", role: "implement", status: "completed", attemptCount: 1, terminalOutcome: "complete" },
  { stepId: "implement-review", role: "actuator", status: "in_progress", attemptCount: 1 },
] as const;

const PIPELINE_SNAPSHOT_MULTI: PipelineSnapshot = {
  pipelineId: "pipe-multi",
  name: "multi-pipeline",
  state: "running",
  terminalPublicationSucceededAt: null,
  terminalPublicationFailure: null,
  createdAt: 1_700_000_000_000,
  finishedAtMs: null,
  stages: [
    {
      id: "stage-multi-implement",
      stageId: "implement",
      branchKey: "default",
      position: 0,
      status: "running",
      workflowInvocationId: PIPELINE_MULTI_INVOCATION,
      startedAt: null,
      endedAt: null,
      decidedAt: null,
      artifact: null,
      failureDetail: null,
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
    createdAt: 0,
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
  const { treeRows } = monitorLeftPaneTreeRows(state, layout, WORKFLOW_FILTER_NOW_MS);
  return treeRows.map((row) => row.id);
}

function overflowPipelineEntryDeps(view: ReturnType<typeof createViewHost>) {
  const terminalColumns = 80;
  const terminalRows = 24;
  const maxVisibleRows = computeShellLayout(terminalColumns, terminalRows, 0).paneHeight;
  const pipelineCount = maxVisibleRows + 10;
  const pipelines = Array.from({ length: pipelineCount }, (_, index) => ({
    pipelineId: `pipe-${index}`,
    name: `pipeline-${index}`,
    state: "succeeded" as const,
    terminalPublicationSucceededAt: null,
    terminalPublicationFailure: null,
    createdAt: 1_700_000_000_000 + index,
    finishedAtMs: 1_700_000_100_000 + index,
    stages: [
      {
        id: `stage-${index}`,
        stageId: "plan",
        branchKey: "default",
        position: 0,
        status: "succeeded" as const,
        workflowInvocationId: `inv-${index}`,
        startedAt: null,
        endedAt: null,
        decidedAt: null,
        artifact: null,
        failureDetail: null,
      },
    ],
  }));
  const runs = pipelines.map((_, index) => ({
    runId: `run-${index}`,
    project: "demo",
    branch: `branch-${index}`,
    createdAt: 0,
    status: "completed" as const,
    isLive: false,
    finishedAtMs: TERMINAL_LIST_FINISH_MS,
    workflow: {
      invocationId: `inv-${index}`,
      steps: [{ stepId: "plan", role: "plan", status: "completed" as const, attemptCount: 1 }],
    },
  }));
  return {
    deps: entryDeps(
      {
        methods: [],
        listResponses: [{ runs }],
        pipelineListResponses: [{ pipelines }],
        waitImpl: async () => ({ runStatus: "completed" }),
      },
      {
        viewHost: view.host,
        nowMs: () => WORKFLOW_FILTER_NOW_MS,
        terminalSize: () => ({ columns: terminalColumns, rows: terminalRows }),
      },
    ).deps,
    terminalColumns,
    terminalRows,
    maxVisibleRows,
    pipelineCount,
    pipelines,
  };
}

function attentionSelectionEntryDeps(view: ReturnType<typeof createViewHost>) {
  const terminalColumns = 80;
  const terminalRows = 24;
  const maxVisibleRows = computeShellLayout(terminalColumns, terminalRows, 0).paneHeight;
  const pipelineCount = maxVisibleRows + 10;
  const pipelines = Array.from({ length: pipelineCount }, (_, index) => ({
    pipelineId: `pipe-${index}`,
    name: `pipeline-${index}`,
    state: "succeeded" as const,
    terminalPublicationSucceededAt: null,
    terminalPublicationFailure: null,
    createdAt: 1_700_000_000_000 + index,
    finishedAtMs: 1_700_000_100_000 + index,
    stages: [
      {
        id: `stage-${index}`,
        stageId: "plan",
        branchKey: "default",
        position: 0,
        status: "succeeded" as const,
        workflowInvocationId: `inv-${index}`,
        startedAt: null,
        endedAt: null,
        decidedAt: null,
        artifact: null,
        failureDetail: null,
      },
    ],
  }));
  const pipelineRuns = pipelines.map((_, index) => ({
    runId: `run-${index}`,
    project: "demo",
    branch: `branch-${index}`,
    createdAt: 0,
    status: "completed" as const,
    isLive: false,
    finishedAtMs: TERMINAL_LIST_FINISH_MS,
    workflow: {
      invocationId: `inv-${index}`,
      steps: [{ stepId: "plan", role: "plan", status: "completed" as const, attemptCount: 1 }],
    },
  }));
  const failedRun: DaemonListRunRow = {
    runId: "run-attention-failed",
    project: "demo",
    branch: "attention",
    createdAt: 0,
    status: "failed",
    isLive: false,
    finishedAtMs: TERMINAL_LIST_FINISH_MS,
  };
  const runs = [...pipelineRuns, failedRun];
  return {
    deps: entryDeps(
      {
        methods: [],
        listResponses: [{ runs }],
        pipelineListResponses: [{ pipelines }],
        waitImpl: async () => ({ runStatus: "completed" }),
        pauseError: new RpcError("run_not_active", "not active"),
      },
      {
        viewHost: view.host,
        nowMs: () => WORKFLOW_FILTER_NOW_MS,
        terminalSize: () => ({ columns: terminalColumns, rows: terminalRows }),
      },
    ).deps,
    terminalColumns,
    terminalRows,
    pipelineCount,
    failedRun,
  };
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
  createdAt: 0,
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
  createdAt: 0,
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

function awaitingPipelineListFixture(): DaemonListRunRow[] {
  return [PIPELINE_RUN_AWAITING, PIPELINE_RUN_ORPHAN];
}

function awaitingAndAlphaPipelineListFixture(): DaemonListRunRow[] {
  return [PIPELINE_RUN_AWAITING, PIPELINE_RUN_MATCHED, PIPELINE_RUN_ORPHAN];
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
    createdAt: 0,
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

function createIntervalScheduler() {
  let onTick: (() => void) | undefined;
  let closed = false;
  return {
    scheduler: {
      start(callback: () => void) {
        onTick = callback;
        return {
          close() {
            closed = true;
          },
        };
      },
    },
    tick() {
      onTick?.();
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
    getControls() {
      return controls;
    },
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
    focusCommand() {
      controls?.focusCommand();
    },
    focusTree() {
      controls?.focusTree();
    },
    insertCommandText(text: string) {
      controls?.insertCommandText(text);
    },
    moveCommandCursorLeft() {
      controls?.moveCommandCursorLeft();
    },
    moveCommandCursorRight() {
      controls?.moveCommandCursorRight();
    },
    deleteCommandBackward() {
      controls?.deleteCommandBackward();
    },
    deleteCommandForward() {
      controls?.deleteCommandForward();
    },
    submitCommand(commandBuffer: string) {
      controls?.submitCommand(commandBuffer);
    },
    toggleSelectedWorkflowExpansion() {
      controls?.toggleSelectedWorkflowExpansion();
    },
    async toggleExpansion() {
      controls?.toggleSelectedWorkflowExpansion();
      await flush();
    },
    quit() {
      controls?.quit();
      exit.resolve();
    },
    quitFromControl() {
      controls?.quit();
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

function countRpcMethod(methods: string[] | undefined, method: string, prefix = false): number {
  return methods?.filter((entry) => (prefix ? entry.startsWith(method) : entry === method)).length ?? 0;
}

async function flushIntervalTick(scheduler: ReturnType<typeof createIntervalScheduler>): Promise<void> {
  scheduler.tick();
  await flush();
  await flush();
  await flush();
}

async function expandPipelineAndSelect(
  view: ReturnType<typeof createViewHost>,
  pipelineId: string,
  nodeId: string,
): Promise<void> {
  view.selectNode(pipelineId);
  await flush();
  const expanded = view.monitorStates.at(-1)?.expandedPipelineNodeIds ?? [];
  if (!expanded.includes(pipelineId)) {
    await view.toggleExpansion();
  }
  view.selectNode(nodeId);
  await flush();
}

function wrapFailingSecondPipelineList(deps: RunTuiEntryDeps): void {
  const originalConnect = deps.connectTuiDaemon;
  let pipelineListCalls = 0;
  deps.connectTuiDaemon = async (options) => {
    if (originalConnect === undefined) throw new Error("missing connectTuiDaemon");
    const client = await originalConnect(options);
    const originalPipelineList = client.pipelineList.bind(client);
    return {
      ...client,
      async pipelineList() {
        pipelineListCalls += 1;
        if (pipelineListCalls === 1) return originalPipelineList();
        throw new RpcConnectionError("pipeline_list failed");
      },
    };
  };
}

function dockCommandFailureAsserter(
  view: ReturnType<typeof createViewHost>,
  verb: string,
): (feedback: string, setup?: () => void) => void {
  return (feedback, setup = () => {}) => {
    setup();
    view.focusCommand();
    while ((view.monitorStates.at(-1)?.commandBuffer ?? "").length > 0) {
      view.deleteCommandBackward();
    }
    view.insertCommandText(verb);
    const commandBuffer = view.monitorStates.at(-1)?.commandBuffer ?? "";
    const commandCursor = view.monitorStates.at(-1)?.commandCursor ?? 0;
    view.submitCommand(commandBuffer);
    expect(view.monitorStates.at(-1)).toMatchObject({
      focus: "command",
      commandBuffer,
      commandCursor,
      lastCommandResult: feedback,
    });
  };
}

function steeringFailureAsserter(
  view: ReturnType<typeof createViewHost>,
  clientOptions: FakeClientOptions,
  verb: string,
  rpcMethod: string,
  rpcPrefix = false,
): (feedback: string, setup?: () => void) => void {
  const assertFailure = dockCommandFailureAsserter(view, verb);
  return (feedback, setup = () => {}) => {
    const rpcBefore = countRpcMethod(clientOptions.methods, rpcMethod, rpcPrefix);
    assertFailure(feedback, setup);
    expect(countRpcMethod(clientOptions.methods, rpcMethod, rpcPrefix)).toBe(rpcBefore);
  };
}

async function runAwaitingStageSteeringRefusalTest(
  verb: "approve" | "reject",
  implKey: "pipelineApproveImpl" | "pipelineRejectImpl",
): Promise<void> {
  const refusalDetail = "status_not_awaiting\n";
  const view = createViewHost();
  const { deps } = entryDeps(
    {
      methods: [],
      listResponses: [{ runs: awaitingPipelineListFixture() }],
      pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_AWAITING] }],
      [implKey]: async () =>
        ({
          kind: "refused",
          pipelineId: "pipe-await",
          stageId: "gate",
          reason: refusalDetail,
        }) as unknown as PipelineApprovalDecisionOutcome,
    },
    { viewHost: view.host, nowMs: () => WORKFLOW_FILTER_NOW_MS },
  );
  const pending = runTuiEntry(deps);

  try {
    await view.waitUntilOpen();
    await flush();
    await expandPipelineAndSelect(view, "pipe-await", PIPELINE_STAGE_AWAITING);
    view.focusCommand();
    view.insertCommandText(verb);
    const buffer = view.monitorStates.at(-1)?.commandBuffer ?? "";
    view.submitCommand(buffer);
    await flush();
    expect(view.monitorStates.at(-1)).toMatchObject({
      focus: "command",
      commandBuffer: buffer,
      lastCommandResult: refusalDetail,
    });
  } finally {
    view.quit();
  }
  expect(await pending).toBe(0);
}

function elapsedCellForRun(state: TuiMonitorState | undefined, runId: string, nowMs: number): string {
  if (state === undefined) return "";
  const layout = computeShellLayout(state.terminalColumns ?? 245, state.terminalRows ?? 72, state.dividerOffset ?? 0);
  const leftPaneWidth = layout.leftWidth >= 90 ? 90 : layout.leftWidth;
  const { treeRows } = monitorLeftPaneTreeRows(state, layout, nowMs);
  const runNode = treeRows.find(
    (row) => (row.kind === "run" || row.kind === "adhoc") && monitorTreeRun(row.tableRow).runId === runId,
  );
  if (runNode?.kind !== "run" && runNode?.kind !== "adhoc") return "";
  // The elapsed atom is always the rightmost cluster segment at this width.
  return buildTreeRunRow(runNode.tableRow, runNode.depth, leftPaneWidth, nowMs).segments.at(-1)?.text ?? "";
}

function timingCellForPipeline(state: TuiMonitorState | undefined, pipelineId: string, nowMs: number): string {
  if (state === undefined) return "";
  const layout = computeShellLayout(state.terminalColumns ?? 245, state.terminalRows ?? 72, state.dividerOffset ?? 0);
  const { fullTreeRows } = monitorLeftPaneTreeRows(state, layout, nowMs);
  const pipeline = fullTreeRows.find((row) => row.kind === "pipeline" && row.id === pipelineId);
  if (pipeline?.kind !== "pipeline") return "";
  return buildPipelineMonitorTreeRow(pipeline, layout.leftWidth, nowMs).segments.at(-1)?.text.trim() ?? "";
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
  pipelineApproveImpl?: (params: PipelineStageMutationParams) => Promise<PipelineApprovalDecisionOutcome>;
  pipelineApproveError?: Error;
  pipelineRejectImpl?: (params: PipelineStageMutationParams) => Promise<PipelineApprovalDecisionOutcome>;
  pipelineRejectError?: Error;
  pipelineResumeImpl?: (params: PipelineResumeParams) => Promise<ResumePipelineOutcome>;
  pipelineResumeError?: Error;
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

  const stageMutationRpc =
    (
      rpcMethod: "pipeline_approve" | "pipeline_reject",
      decision: "approved" | "rejected",
      error: Error | undefined,
      impl: ((params: PipelineStageMutationParams) => Promise<PipelineApprovalDecisionOutcome>) | undefined,
    ) =>
    async (params: PipelineStageMutationParams) => {
      methods.push(rpcMethod);
      if (error !== undefined) throw error;
      return (
        impl ??
        (async () => ({
          kind: "applied" as const,
          pipelineId: params.pipelineId,
          stageId: params.stageId,
          decision,
        }))
      )(params);
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
    pipelineApprove: stageMutationRpc(
      "pipeline_approve",
      "approved",
      options.pipelineApproveError,
      options.pipelineApproveImpl,
    ),
    pipelineReject: stageMutationRpc(
      "pipeline_reject",
      "rejected",
      options.pipelineRejectError,
      options.pipelineRejectImpl,
    ),
    async pipelineResume(params) {
      methods.push("pipeline_resume");
      if (options.pipelineResumeError !== undefined) throw options.pipelineResumeError;
      return (
        options.pipelineResumeImpl ?? (async () => ({ kind: "resumed" as const, pipelineId: params.pipelineId }))
      )(params);
    },
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
      machineProfile: "unknown",
      admitDetachedPipelineStart: noopDetachedAdmission,
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
  test("quits through monitor controls without a renderer exit", async () => {
    const view = createViewHost();
    const { deps } = entryDeps({}, { viewHost: view.host });
    const pending = runTuiEntry(deps);

    await view.waitUntilOpen();
    view.quitFromControl();

    expect(await pending).toBe(0);
    expect(view.isClosed()).toBe(true);
  });

  test("edits command state through monitor controls", async () => {
    // @mutate v2/src/tui/tui-entry.tsx "return Array.from(COMMAND_GRAPHEME_SEGMENTER.segment(value), ({ segment }) => segment);" -> "return Array.from(value);"
    // @mutate v2/src/tui/tui-entry.tsx "return Math.min(Math.max(cursor, 0), graphemeCount);" -> "return cursor;"
    // @mutate v2/src/tui/tui-entry.tsx "if (inserted.length === 0) return;" -> "if (false) return;"
    // @mutate v2/src/tui/tui-entry.tsx "if (deleteIndex < 0 || deleteIndex >= graphemes.length) return;" -> "if (false) return;"
    const view = createViewHost();
    const { deps } = entryDeps({}, { viewHost: view.host });
    const pending = runTuiEntry(deps);
    const expectEditor = (focus: "tree" | "command", buffer: string, cursor: number, input: string): void => {
      const state = view.monitorStates.at(-1);
      expect(state).toMatchObject({ focus, commandBuffer: buffer, commandCursor: cursor });
      expect(state).toBeDefined();
      if (state !== undefined) expect(monitorDockLines(state)[1]).toBe(input);
    };

    try {
      await view.waitUntilOpen();
      await flush();
      expectEditor("tree", "", 0, "> ▏");

      view.focusCommand();
      expectEditor("command", "", 0, "> ▏");
      view.insertCommandText("Ae\u0301B");
      expectEditor("command", "Ae\u0301B", 3, "> Ae\u0301B▏");
      view.moveCommandCursorLeft();
      expectEditor("command", "Ae\u0301B", 2, "> Ae\u0301▏B");
      view.moveCommandCursorLeft();
      expectEditor("command", "Ae\u0301B", 1, "> A▏e\u0301B");
      view.insertCommandText("👩‍💻🇺🇳");
      expectEditor("command", "A👩‍💻🇺🇳e\u0301B", 3, "> A👩‍💻🇺🇳▏e\u0301B");
      view.insertCommandText("\u0301");
      expectEditor("command", "A👩‍💻🇺🇳\u0301e\u0301B", 3, "> A👩‍💻🇺🇳\u0301▏e\u0301B");
      view.moveCommandCursorLeft();
      expectEditor("command", "A👩‍💻🇺🇳\u0301e\u0301B", 2, "> A👩‍💻▏🇺🇳\u0301e\u0301B");
      view.moveCommandCursorRight();
      expectEditor("command", "A👩‍💻🇺🇳\u0301e\u0301B", 3, "> A👩‍💻🇺🇳\u0301▏e\u0301B");
      view.deleteCommandBackward();
      expectEditor("command", "A👩‍💻e\u0301B", 2, "> A👩‍💻▏e\u0301B");
      view.deleteCommandForward();
      expectEditor("command", "A👩‍💻B", 2, "> A👩‍💻▏B");

      view.moveCommandCursorLeft();
      expectEditor("command", "A👩‍💻B", 1, "> A▏👩‍💻B");
      view.moveCommandCursorLeft();
      expectEditor("command", "A👩‍💻B", 0, "> ▏A👩‍💻B");
      view.moveCommandCursorLeft();
      expectEditor("command", "A👩‍💻B", 0, "> ▏A👩‍💻B");
      const beforeSuppressedEdits = view.monitorStates.length;
      view.deleteCommandBackward();
      view.insertCommandText("");
      expect(view.monitorStates).toHaveLength(beforeSuppressedEdits);
      expectEditor("command", "A👩‍💻B", 0, "> ▏A👩‍💻B");

      view.moveCommandCursorRight();
      expectEditor("command", "A👩‍💻B", 1, "> A▏👩‍💻B");
      view.moveCommandCursorRight();
      expectEditor("command", "A👩‍💻B", 2, "> A👩‍💻▏B");
      view.moveCommandCursorRight();
      expectEditor("command", "A👩‍💻B", 3, "> A👩‍💻B▏");
      view.moveCommandCursorRight();
      expectEditor("command", "A👩‍💻B", 3, "> A👩‍💻B▏");
      const beforeSuppressedDelete = view.monitorStates.length;
      view.deleteCommandForward();
      expect(view.monitorStates).toHaveLength(beforeSuppressedDelete);
      expectEditor("command", "A👩‍💻B", 3, "> A👩‍💻B▏");

      view.focusTree();
      expectEditor("tree", "A👩‍💻B", 3, "> A👩‍💻B▏");
    } finally {
      view.quit();
    }
    expect(await pending).toBe(0);
  });

  test("retains focused command editor state across refresh", async () => {
    const view = createViewHost();
    const refresh = createIntervalScheduler();
    const { deps } = entryDeps({}, { viewHost: view.host, refreshScheduler: refresh.scheduler });
    const pending = runTuiEntry(deps);

    try {
      await view.waitUntilOpen();
      await flush();
      view.focusCommand();
      view.insertCommandText("A👩‍💻B");
      view.moveCommandCursorLeft();
      const beforeRefresh = view.monitorStates.at(-1);
      expect(beforeRefresh).toMatchObject({ focus: "command", commandBuffer: "A👩‍💻B", commandCursor: 2 });
      expect(beforeRefresh).toBeDefined();
      if (beforeRefresh === undefined) throw new Error("expected command editor state");
      const dockBeforeRefresh = monitorDockLines(beforeRefresh);

      await flushIntervalTick(refresh);

      expect(view.monitorStates.at(-1)).toMatchObject({
        focus: "command",
        commandBuffer: "A👩‍💻B",
        commandCursor: 2,
      });
      const afterRefresh = view.monitorStates.at(-1);
      expect(afterRefresh).toBeDefined();
      if (afterRefresh !== undefined) expect(monitorDockLines(afterRefresh)).toEqual(dockBeforeRefresh);
    } finally {
      view.quit();
    }
    expect(await pending).toBe(0);
  });

  test("dispatches focused command submissions through parse-once routing and detached admission", async () => {
    // @mutate v2/src/tui/tui-entry.tsx "const parsed = parseTuiCommand(commandBuffer);" -> "parseTuiCommand(commandBuffer); const parsed = parseTuiCommand(commandBuffer);"
    // @mutate v2/src/tui/tui-entry.tsx "if (commandSubmissionBlockedByPendingAdmission(admissionPending)) return;" -> "if (false) return;"
    // @mutate v2/src/tui/tui-entry.tsx "return monitorOpen && submissionEditorGeneration === currentEditorGeneration;" -> "return false;"
    // @mutate v2/src/tui/tui-entry.tsx "lastCommandResult: result.pipelineId," -> "lastCommandResult: result.pipelineId, selectedNodeId: null,"
    // @mutate v2/src/tui/tui-entry.tsx "if (isExpandablePipelineNodeId(pipelineNodes, selectedNodeId)) return null;" -> "if (false) return null;"
    const parseSpy = spyOn(tuiCommandParser, "parseTuiCommand");
    const view = createViewHost();
    const admissionGate = deferred<PipelineStartAdmissionResult>();
    let admissionCalls = 0;
    const { deps } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: pipelineTreeListFixture() }],
        pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_ALPHA] }],
      },
      {
        viewHost: view.host,
        nowMs: () => WORKFLOW_FILTER_NOW_MS,
        admitDetachedPipelineStart: async (input) => {
          admissionCalls += 1;
          if (input.seedPath !== undefined) {
            expect(input).toEqual({ projectKey: "demo", seedPath: "seeds/foo.md" });
          } else {
            expect(input).toEqual({ projectKey: "demo", seedText: "Ship feature" });
          }
          return admissionGate.promise;
        },
      },
    );
    const pending = runTuiEntry(deps);

    try {
      await view.waitUntilOpen();
      await flush();
      view.focusCommand();

      view.insertCommandText("start demo --seed seeds/foo.md");
      const pathSeedBuffer = view.monitorStates.at(-1)?.commandBuffer ?? "";
      view.submitCommand(pathSeedBuffer);
      expect(parseSpy).toHaveBeenCalledTimes(1);
      expect(parseSpy).toHaveBeenCalledWith(pathSeedBuffer);
      expect(admissionCalls).toBe(1);
      const pendingStateCount = view.monitorStates.length;
      view.selectNode("run-orphan");
      await flush();
      expect(view.monitorStates.length).toBeGreaterThan(pendingStateCount);
      expect(view.monitorStates.at(-1)?.selectedNodeId).toBe("run-orphan");

      view.submitCommand(pathSeedBuffer);
      expect(parseSpy).toHaveBeenCalledTimes(1);
      expect(admissionCalls).toBe(1);

      admissionGate.resolve({ kind: "admitted", pipelineId: "pipe-admitted" });
      await flush();
      expect(view.monitorStates.at(-1)).toMatchObject({
        lastCommandResult: "pipe-admitted",
        commandBuffer: "",
        commandCursor: 0,
        focus: "tree",
        selectedNodeId: "run-orphan",
      });

      view.focusCommand();
      view.insertCommandText("start demo --seed-text Ship feature");
      const _textSeedBuffer = view.monitorStates.at(-1)?.commandBuffer ?? "";
      const textAdmissionGate = deferred<PipelineStartAdmissionResult>();
      let textAdmissionCalls = 0;
      const textView = createViewHost();
      const textPending = runTuiEntry(
        entryDeps(
          {
            methods: [],
            listResponses: [{ runs: pipelineTreeListFixture() }],
            pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_ALPHA] }],
          },
          {
            viewHost: textView.host,
            nowMs: () => WORKFLOW_FILTER_NOW_MS,
            admitDetachedPipelineStart: async (input) => {
              textAdmissionCalls += 1;
              expect(input).toEqual({ projectKey: "demo", seedText: "Ship feature" });
              return textAdmissionGate.promise;
            },
          },
        ).deps,
      );
      await textView.waitUntilOpen();
      await flush();
      textView.focusCommand();
      textView.insertCommandText('start demo --seed-text "Ship feature"');
      const textBuffer = textView.monitorStates.at(-1)?.commandBuffer ?? "";
      const statesBeforeResolve = textView.monitorStates.length;
      textView.submitCommand(textBuffer);
      expect(textAdmissionCalls).toBe(1);
      expect(textView.monitorStates.length).toBeGreaterThanOrEqual(statesBeforeResolve);
      textAdmissionGate.resolve({ kind: "admitted", pipelineId: "pipe-text" });
      await flush();
      expect(textView.monitorStates.at(-1)?.lastCommandResult).toBe("pipe-text");
      textView.quit();
      expect(await textPending).toBe(0);
    } finally {
      parseSpy.mockRestore();
      view.quit();
    }
    expect(await pending).toBe(0);
  });

  test("suppresses stale admission settlements and post-close updates", async () => {
    const view = createViewHost();
    const admissionGate = deferred<PipelineStartAdmissionResult>();
    let admissionCalls = 0;
    const { deps } = entryDeps(
      { methods: [], listResponses: [{ runs: [RUN_ALPHA] }] },
      {
        viewHost: view.host,
        admitDetachedPipelineStart: async () => {
          admissionCalls += 1;
          return admissionGate.promise;
        },
      },
    );
    const pending = runTuiEntry(deps);

    try {
      await view.waitUntilOpen();
      await flush();
      view.focusCommand();
      view.insertCommandText("start demo --seed-text pending");
      const bufferBeforeEdit = view.monitorStates.at(-1)?.commandBuffer ?? "";
      view.submitCommand(bufferBeforeEdit);
      expect(admissionCalls).toBe(1);

      view.insertCommandText("!");
      await flush();
      const edited = view.monitorStates.at(-1);
      expect(edited).toMatchObject({ commandBuffer: `${bufferBeforeEdit}!`, focus: "command" });

      admissionGate.resolve({ kind: "admitted", pipelineId: "pipe-stale" });
      await flush();
      expect(view.monitorStates.at(-1)).toMatchObject({
        commandBuffer: `${bufferBeforeEdit}!`,
        focus: "command",
        lastCommandResult: null,
      });
    } finally {
      view.quit();
    }
    expect(await pending).toBe(0);

    const closeView = createViewHost();
    const closeGate = deferred<PipelineStartAdmissionResult>();
    let closeAdmissionCalls = 0;
    const closePending = runTuiEntry(
      entryDeps(
        { methods: [], listResponses: [{ runs: [RUN_ALPHA] }] },
        {
          viewHost: closeView.host,
          admitDetachedPipelineStart: async () => {
            closeAdmissionCalls += 1;
            return closeGate.promise;
          },
        },
      ).deps,
    );
    await closeView.waitUntilOpen();
    await flush();
    closeView.focusCommand();
    closeView.insertCommandText("start demo --seed-text close");
    const closeBuffer = closeView.monitorStates.at(-1)?.commandBuffer ?? "";
    closeView.submitCommand(closeBuffer);
    expect(closeAdmissionCalls).toBe(1);
    const statesBeforeClose = closeView.monitorStates.length;
    closeView.quit();
    closeGate.resolve({ kind: "admitted", pipelineId: "pipe-after-close" });
    await flush();
    expect(closeView.monitorStates).toHaveLength(statesBeforeClose);
    expect(await closePending).toBe(0);
  });

  test("reports parser and admission failures without losing repairable command input", async () => {
    const view = createViewHost();
    let admissionCalls = 0;
    const { deps } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: pipelineTreeListFixture() }],
        pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_ALPHA] }],
      },
      {
        viewHost: view.host,
        admitDetachedPipelineStart: async () => {
          admissionCalls += 1;
          return {
            kind: "pre-admission-failure",
            failure: "unregistered-project",
            detail: "unregistered project: missing\n",
          };
        },
      },
    );
    const pending = runTuiEntry(deps);

    try {
      await view.waitUntilOpen();
      await flush();

      const submitParseFailure = (buffer: string, feedback: string): void => {
        view.focusCommand();
        while ((view.monitorStates.at(-1)?.commandBuffer ?? "").length > 0) {
          view.deleteCommandBackward();
        }
        view.insertCommandText(buffer);
        const current = view.monitorStates.at(-1);
        expect(current).toBeDefined();
        if (current === undefined) throw new Error("expected command editor state");
        const beforeCalls = admissionCalls;
        view.submitCommand(current.commandBuffer ?? "");
        expect(admissionCalls).toBe(beforeCalls);
        expect(view.monitorStates.at(-1)).toMatchObject({
          focus: "command",
          commandBuffer: current.commandBuffer,
          commandCursor: current.commandCursor,
          lastCommandResult: feedback,
        });
      };

      submitParseFailure("wat", "unknown_verb");
      submitParseFailure("approve foo", "unexpected_arguments");
      submitParseFailure("start", "missing_project");

      view.focusCommand();
      while ((view.monitorStates.at(-1)?.commandBuffer ?? "").length > 0) {
        view.deleteCommandBackward();
      }
      view.insertCommandText("start missing --seed-text text");
      const preAdmissionBuffer = view.monitorStates.at(-1)?.commandBuffer ?? "";
      view.submitCommand(preAdmissionBuffer);
      await flush();
      expect(admissionCalls).toBe(1);
      expect(view.monitorStates.at(-1)).toMatchObject({
        focus: "command",
        commandBuffer: preAdmissionBuffer,
        lastCommandResult: "unregistered-project: unregistered project: missing\n",
      });
    } finally {
      view.quit();
    }
    expect(await pending).toBe(0);

    const refusalDetail = "pipeline_start refused: branch locked\n";
    const refusalView = createViewHost();
    let refusalCalls = 0;
    const refusalPending = runTuiEntry(
      entryDeps(
        { methods: [], listResponses: [{ runs: [RUN_ALPHA] }] },
        {
          viewHost: refusalView.host,
          admitDetachedPipelineStart: async () => {
            refusalCalls += 1;
            return {
              kind: "admission-failure",
              failure: "daemon-refusal",
              detail: refusalDetail,
            };
          },
        },
      ).deps,
    );
    await refusalView.waitUntilOpen();
    await flush();
    refusalView.focusCommand();
    refusalView.insertCommandText("start demo --seed-text retry");
    const refusalBuffer = refusalView.monitorStates.at(-1)?.commandBuffer ?? "";
    refusalView.submitCommand(refusalBuffer);
    await flush();
    expect(refusalCalls).toBe(1);
    expect(refusalView.monitorStates.at(-1)).toMatchObject({
      focus: "command",
      commandBuffer: refusalBuffer,
      lastCommandResult: refusalDetail,
    });
    refusalView.quit();
    expect(await refusalPending).toBe(0);
  });

  test("dispatches explicit expand and collapse without admission", async () => {
    const view = createViewHost();
    const { deps } = pipelineMultiEntryDeps(view);
    let admissionCalls = 0;
    deps.admitDetachedPipelineStart = async () => {
      admissionCalls += 1;
      return { kind: "admitted", pipelineId: "unused" };
    };
    const pending = runTuiEntry(deps);

    try {
      await view.waitUntilOpen();
      await flush();
      view.selectNode("pipe-multi");
      view.focusCommand();
      view.insertCommandText("expand");
      view.submitCommand("expand");
      expect(admissionCalls).toBe(0);
      expect(view.monitorStates.at(-1)).toMatchObject({
        selectedNodeId: "pipe-multi",
        commandBuffer: "",
        commandCursor: 0,
        lastCommandResult: null,
      });
      expect(view.monitorStates.at(-1)?.expandedPipelineNodeIds ?? []).toContain("pipe-multi");

      view.insertCommandText("expand");
      view.submitCommand("expand");
      expect(view.monitorStates.at(-1)?.expandedPipelineNodeIds ?? []).toContain("pipe-multi");

      view.insertCommandText("collapse");
      view.submitCommand("collapse");
      expect(view.monitorStates.at(-1)?.expandedPipelineNodeIds ?? []).not.toContain("pipe-multi");

      view.insertCommandText("collapse");
      view.submitCommand("collapse");
      expect(view.monitorStates.at(-1)?.expandedPipelineNodeIds ?? []).not.toContain("pipe-multi");

      view.insertCommandText("expand");
      view.submitCommand("expand");
      view.selectNode(PIPELINE_STAGE_MULTI);
      view.focusCommand();
      view.insertCommandText("expand");
      view.submitCommand("expand");
      expect(view.monitorStates.at(-1)?.expandedPipelineNodeIds ?? []).toContain(PIPELINE_STAGE_MULTI);
    } finally {
      view.quit();
    }
    expect(await pending).toBe(0);
  });

  test("reports expansion selection feedback without mutating expansion state", async () => {
    const emptyView = createViewHost();
    const emptyPending = runTuiEntry(
      entryDeps(
        { methods: [], listResponses: [{ runs: [] }], pipelineListResponses: [{ pipelines: [] }] },
        { viewHost: emptyView.host, nowMs: () => WORKFLOW_FILTER_NOW_MS },
      ).deps,
    );
    await emptyView.waitUntilOpen();
    await flush();
    emptyView.focusCommand();
    emptyView.insertCommandText("expand");
    emptyView.submitCommand("expand");
    expect(emptyView.monitorStates.at(-1)).toMatchObject({
      selectedNodeId: null,
      focus: "command",
      commandBuffer: "expand",
      lastCommandResult: "no_selection",
      expandedPipelineNodeIds: [],
    });
    emptyView.quit();
    expect(await emptyPending).toBe(0);

    const view = createViewHost();
    const { deps } = pipelineMultiEntryDeps(view);
    const pending = runTuiEntry(deps);

    try {
      await view.waitUntilOpen();
      await flush();
      const expectExpansionFailure = (feedback: string, setup: () => void): void => {
        setup();
        const before = view.monitorStates.at(-1);
        expect(before).toBeDefined();
        if (before === undefined) throw new Error("expected monitor state");
        const expandedBefore = [...(before.expandedPipelineNodeIds ?? [])];
        view.focusCommand();
        while ((view.monitorStates.at(-1)?.commandBuffer ?? "").length > 0) {
          view.deleteCommandBackward();
        }
        view.insertCommandText("expand");
        const commandBuffer = view.monitorStates.at(-1)?.commandBuffer ?? "";
        view.submitCommand(commandBuffer);
        expect(view.monitorStates.at(-1)).toMatchObject({
          focus: "command",
          commandBuffer,
          lastCommandResult: feedback,
        });
        expect([...(view.monitorStates.at(-1)?.expandedPipelineNodeIds ?? [])].sort()).toEqual(expandedBefore.sort());
      };

      await view.toggleExpansion();
      view.selectNode("run-review");
      expectExpansionFailure("run_leaf", () => {});

      // @mutate v2/src/tui/tui-entry.tsx "row.kind === \"adhoc\"" -> "false"
      view.selectNode("run-orphan");
      expectExpansionFailure("unattributed", () => {});

      expect(
        expansionCommandSelectionError(
          {
            runs: pipelineMultiListFixture(),
            selectedNodeId: "pipe-gone",
            steeringFeedback: null,
            pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [PIPELINE_SNAPSHOT_MULTI] } },
          },
          WORKFLOW_FILTER_NOW_MS,
        ),
      ).toBe("stale_non_expandable");
    } finally {
      view.quit();
    }
    expect(await pending).toBe(0);
  });

  test("command dispatch guard predicates reject inverted conditions", () => {
    expect(commandSubmissionBlockedByPendingAdmission(true)).toBe(true);
    expect(commandSubmissionBlockedByPendingAdmission(false)).toBe(false);
    expect(shouldApplyCommandSettlement(1, 1, true)).toBe(true);
    expect(shouldApplyCommandSettlement(1, 2, true)).toBe(false);
    expect(shouldApplyCommandSettlement(1, 1, false)).toBe(false);
  });

  test("dock session state starts explicit and survives refresh and display updates", async () => {
    const view = createViewHost();
    const refresh = createIntervalScheduler();
    const displayTick = createIntervalScheduler();
    const { deps } = entryDeps(
      {
        listResponses: [{ runs: [RUN_ALPHA] }, { runs: [RUN_BETA] }],
      },
      {
        viewHost: view.host,
        refreshScheduler: refresh.scheduler,
        displayTickScheduler: displayTick.scheduler,
      },
    );

    const pending = runTuiEntry(deps);
    try {
      await view.waitUntilOpen();
      await flush();
      const dockSessionState = {
        commandBuffer: "",
        commandCursor: 0,
        focus: "tree",
        lastCommandResult: null,
        lastRpcError: null,
      } as const;
      expect(view.monitorStates.at(-1)).toMatchObject(dockSessionState);

      await flushIntervalTick(refresh);
      expect(view.monitorStates.at(-1)).toMatchObject(dockSessionState);

      const stateCountBeforeDisplay = view.monitorStates.length;
      await flushIntervalTick(displayTick);
      expect(view.monitorStates.length).toBeGreaterThan(stateCountBeforeDisplay);
      expect(view.monitorStates.at(-1)).toMatchObject(dockSessionState);
    } finally {
      view.quit();
    }
    expect(await pending).toBe(0);
  });

  test("recoverable refresh failures retain observations and latest feedback until full success", async () => {
    // @mutate v2/src/tui/tui-entry.tsx "if (error === undefined) return null;" -> "if (error !== undefined) return null;"
    // @mutate v2/src/tui/tui-entry.tsx "if (error instanceof RpcError || error instanceof RpcConnectionError) return steeringFeedbackFromError(error);" -> "if (!(error instanceof RpcError || error instanceof RpcConnectionError)) return steeringFeedbackFromError(error);"
    // @mutate v2/src/tui/tui-entry.tsx "if (error instanceof Error) return `daemon_error: ${(error as Error).message}`;" -> "if (!(error instanceof Error)) return `daemon_error: ${(error as Error).message}`;"
    const view = createViewHost();
    const refresh = createIntervalScheduler();
    const client = fakeClient({
      listResponses: [{ runs: [RUN_ALPHA] }, { runs: [RUN_ALPHA] }, { runs: [RUN_ALPHA] }, { runs: [RUN_BETA] }],
      pipelineListResponses: [
        { pipelines: [PIPELINE_SNAPSHOT_ALPHA] },
        { pipelines: [PIPELINE_SNAPSHOT_ALPHA] },
        { pipelines: [PIPELINE_SNAPSHOT_BETA] },
      ],
    });
    let listCalls = 0;
    const list = client.list.bind(client);
    client.list = async () => {
      listCalls += 1;
      if (listCalls === 3) {
        throw new RpcError("list_failed", "list failed");
      }
      return list();
    };
    let pipelineListCalls = 0;
    const pipelineList = client.pipelineList.bind(client);
    client.pipelineList = async () => {
      pipelineListCalls += 1;
      if (pipelineListCalls === 3) {
        throw new RpcConnectionError("pipeline observation failed");
      }
      return pipelineList();
    };
    let discoveryCalls = 0;
    const { deps } = entryDeps(
      {},
      {
        viewHost: view.host,
        refreshScheduler: refresh.scheduler,
        connectTuiDaemon: async () => client,
        socketDiscovery: async () => {
          discoveryCalls += 1;
          if (discoveryCalls === 2) throw new Error("discovery failed");
          return [];
        },
      },
    );

    const pending = runTuiEntry(deps);
    try {
      await view.waitUntilOpen();
      await flush();
      const retainedResult = view.monitorStates.at(-1)?.lastCommandResult;
      const retainedObservations = {
        runs: [RUN_ALPHA],
        pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [PIPELINE_SNAPSHOT_ALPHA] } },
        lastCommandResult: retainedResult,
      };

      await flushIntervalTick(refresh);
      for (let attempt = 0; attempt < 20 && view.monitorStates.at(-1)?.lastRpcError === null; attempt += 1) {
        await flush();
      }
      expect(view.monitorStates.at(-1)).toMatchObject({
        ...retainedObservations,
        lastRpcError: "daemon_error: discovery failed",
      });

      await flushIntervalTick(refresh);
      for (
        let attempt = 0;
        attempt < 20 && view.monitorStates.at(-1)?.lastRpcError !== "list_failed: list failed";
        attempt += 1
      ) {
        await flush();
      }
      expect(view.monitorStates.at(-1)).toMatchObject({
        ...retainedObservations,
        lastRpcError: "list_failed: list failed",
      });

      await flushIntervalTick(refresh);
      for (
        let attempt = 0;
        attempt < 20 && view.monitorStates.at(-1)?.lastRpcError !== "daemon_error: pipeline observation failed";
        attempt += 1
      ) {
        await flush();
      }
      expect(view.monitorStates.at(-1)).toMatchObject({
        ...retainedObservations,
        lastRpcError: "daemon_error: pipeline observation failed",
      });
      expect(view.isClosed()).toBe(false);

      await flushIntervalTick(refresh);
      for (let attempt = 0; attempt < 20 && view.monitorStates.at(-1)?.lastRpcError !== null; attempt += 1) {
        await flush();
      }
      expect(view.monitorStates.at(-1)).toMatchObject({
        runs: [RUN_BETA],
        pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [PIPELINE_SNAPSHOT_BETA] } },
        lastCommandResult: retainedResult,
        lastRpcError: null,
      });
    } finally {
      view.quit();
    }
    expect(await pending).toBe(0);
  });

  test("partial initial admission opens with retained connection feedback", async () => {
    const view = createViewHost();
    const first = fakeClient({ listResponses: [{ runs: [RUN_ALPHA] }] });
    const pending = runTuiEntry({
      socketPath: DAEMON1_SOCKET,
      machineProfile: "test",
      admitDetachedPipelineStart: noopDetachedAdmission,
      viewHost: view.host,
      socketDiscovery: async () => [DAEMON1_SOCKET, DAEMON2_SOCKET],
      connectTuiDaemon: async (options) => {
        if (options?.socketPath === DAEMON1_SOCKET) return first;
        throw new RpcConnectionError("second daemon unavailable");
      },
    });

    await view.waitUntilOpen();
    expect(view.monitorStates.at(-1)).toMatchObject({
      runs: [RUN_ALPHA],
      lastRpcError: "daemon_error: second daemon unavailable",
    });
    view.quit();
    expect(await pending).toBe(0);
  });

  test("retained rows lose actions while disconnected and resume ownership after reconnect", async () => {
    const view = createViewHost();
    const refresh = createIntervalScheduler();
    const firstMethods: string[] = [];
    const secondMethods: string[] = [];
    const first = fakeClient({ methods: firstMethods, listResponses: [{ runs: [RUN_ALPHA] }] });
    const firstList = first.list.bind(first);
    let firstListCalls = 0;
    first.list = async () => {
      firstListCalls += 1;
      if (firstListCalls > 1) throw new RpcConnectionError("connection reset");
      return firstList();
    };
    const second = fakeClient({ methods: secondMethods, listResponses: [{ runs: [RUN_ALPHA] }] });
    const clients = [first, second];
    let clientIndex = 0;
    const { deps } = entryDeps(
      {},
      {
        viewHost: view.host,
        refreshScheduler: refresh.scheduler,
        connectTuiDaemon: async () => clients[clientIndex++] ?? Promise.reject(new Error("missing client")),
      },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    await flushIntervalTick(refresh);
    expect(view.monitorStates.at(-1)).toMatchObject({
      runs: [RUN_ALPHA],
      selectedNodeId: "run-alpha",
      actionableRunIds: [],
    });
    view.killSelected();
    await flush();
    expect(firstMethods).not.toContain("kill:run-alpha");

    await flushIntervalTick(refresh);
    expect(view.monitorStates.at(-1)?.actionableRunIds).toEqual(["run-alpha"]);
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe("run-alpha");
    view.quit();
    expect(await pending).toBe(0);
  });

  test("a selected pipeline that leaves the snapshot clears the selection", async () => {
    const view = createViewHost();
    const refresh = createIntervalScheduler();
    const { deps } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: pipelineTreeListFixture() }],
        pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_ALPHA] }, { pipelines: [] }],
        waitImpl: async () => ({ runStatus: "completed" }),
      },
      { viewHost: view.host, nowMs: () => WORKFLOW_FILTER_NOW_MS, refreshScheduler: refresh.scheduler },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    view.selectNode("pipe-alpha");
    await flush();
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe("pipe-alpha");

    // The pipeline disappears from the next snapshot, so its row is no longer selectable.
    await flushIntervalTick(refresh);
    for (let i = 0; i < 20 && view.monitorStates.at(-1)?.selectedNodeId === "pipe-alpha"; i += 1) {
      await flush();
    }
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBeNull();

    view.quit();
    await pending;
  });

  test("dropping one socket evicts only that client's run ownership", async () => {
    const view = createViewHost();
    const refresh = createIntervalScheduler();
    const survivorMethods: string[] = [];
    let discoveryPhase = 0;
    const clients = new Map([
      [DAEMON1_SOCKET, fakeClient({ methods: [], listResponses: [{ runs: [{ ...RUN_ALPHA, isLive: true }] }] })],
      [
        DAEMON2_SOCKET,
        fakeClient({ methods: survivorMethods, listResponses: [{ runs: [{ ...RUN_GAMMA, isLive: true }] }] }),
      ],
    ]);
    const { deps } = entryDeps(
      {},
      {
        socketPath: DAEMON2_SOCKET,
        viewHost: view.host,
        refreshScheduler: refresh.scheduler,
        connectTuiDaemon: async (options) => {
          const client = options?.socketPath === undefined ? undefined : clients.get(options.socketPath);
          if (client === undefined) throw new Error(`missing client for ${options?.socketPath}`);
          return client as TuiDaemonClient;
        },
        socketDiscovery: async () => {
          discoveryPhase += 1;
          // The first daemon goes away after the opening refresh.
          return discoveryPhase === 1 ? [DAEMON1_SOCKET, DAEMON2_SOCKET] : [DAEMON2_SOCKET];
        },
      },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    await flushIntervalTick(refresh);
    for (let i = 0; i < 20 && view.monitorStates.at(-1)?.runs.some((run) => run.runId === "run-alpha"); i += 1) {
      await flush();
    }

    view.selectNode("run-gamma");
    await flush();
    view.pauseSelected();
    await flush();
    view.quit();
    await pending;

    // run-gamma is owned by the surviving daemon; evicting daemon1 must not take its owner with it.
    expect(survivorMethods).toContain("pause:run-gamma");
  });

  test("invocation identity survives discovery addition, selection, and removal", async () => {
    // @mutate v2/src/tui/tui-entry.tsx "if (match === null) return \"unknown\";" -> "if (match !== null) return \"unknown\";"
    const view = createViewHost();
    const refresh = createIntervalScheduler();
    const invokingSocket = "/tmp/daemon-ABCDEF0123456789.sock";
    const discoveredSocket = "/tmp/daemon-fedcba9876543210.sock";
    let discoveryPhase = 0;
    const clients = new Map([
      [invokingSocket, fakeClient({ listResponses: [{ runs: [RUN_ALPHA] }] })],
      [discoveredSocket, fakeClient({ listResponses: [{ runs: [RUN_BETA] }] })],
    ]);
    const { deps } = entryDeps(
      {},
      {
        socketPath: invokingSocket,
        viewHost: view.host,
        refreshScheduler: refresh.scheduler,
        connectTuiDaemon: async (options) => {
          const socketPath = options?.socketPath;
          const client = socketPath === undefined ? undefined : clients.get(socketPath);
          if (client === undefined) throw new Error(`missing client for ${socketPath}`);
          return client;
        },
        socketDiscovery: async () => {
          discoveryPhase += 1;
          return discoveryPhase === 1 || discoveryPhase >= 3 ? [invokingSocket] : [invokingSocket, discoveredSocket];
        },
      },
    );
    const invocationDeps = { ...deps, machineProfile: "workstation" };
    const invocationIdentity = {
      machineProfile: "workstation",
      keyedSocketDigest: "abcdef0123456789",
    };

    const pending = runTuiEntry(invocationDeps);
    await view.waitUntilOpen();
    await flush();
    expect(view.monitorStates.at(-1)).toMatchObject(invocationIdentity);

    await flushIntervalTick(refresh);
    for (let i = 0; i < 20 && !view.monitorStates.at(-1)?.runs.some((run) => run.runId === "run-beta"); i += 1) {
      await flush();
    }
    view.selectNode("run-beta");
    expect(view.monitorStates.at(-1)).toMatchObject({
      selectedNodeId: "run-beta",
      ...invocationIdentity,
    });

    await flushIntervalTick(refresh);
    for (let i = 0; i < 20 && view.monitorStates.at(-1)?.runs.some((run) => run.runId === "run-beta"); i += 1) {
      await flush();
    }
    expect(view.monitorStates.at(-1)).toMatchObject({
      selectedNodeId: "run-beta",
      ...invocationIdentity,
    });

    view.quit();
    expect(await pending).toBe(0);
  });

  test("unparseable invoking socket stays unknown when discovery supplies a keyed socket", async () => {
    const view = createViewHost();
    const discoveredSocket = "/tmp/daemon-fedcba9876543210.sock";
    const { deps } = entryDeps(
      { listResponses: [{ runs: [RUN_ALPHA] }] },
      {
        socketPath: "/tmp/not-a-keyed-daemon.sock",
        viewHost: view.host,
        socketDiscovery: async () => [discoveredSocket],
      },
    );

    const invocationDeps = { ...deps, machineProfile: "workstation" };
    const pending = runTuiEntry(invocationDeps);
    await view.waitUntilOpen();
    expect(view.monitorStates.at(-1)).toMatchObject({
      machineProfile: "workstation",
      keyedSocketDigest: "unknown",
    });

    view.quit();
    expect(await pending).toBe(0);
  });

  test("unavailable daemon at connect records unavailable feedback, exits 1, and skips list/wait", async () => {
    const view = createViewHost();
    let attempted = false;

    const code = await runTuiEntry({
      socketPath: "/tmp/test.sock",
      machineProfile: "test",
      admitDetachedPipelineStart: noopDetachedAdmission,
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

    await view.toggleExpansion();
    view.selectNode(PIPELINE_STAGE_MULTI);
    await flush();
    expect(leftPaneTreeRowIds(view.monitorStates.at(-1))).toContain("run-review");
    expect(leftPaneTreeRowIds(view.monitorStates.at(-1))).not.toContain("run-implement");

    await view.toggleExpansion();
    expect(view.monitorStates.at(-1)?.expandedPipelineNodeIds ?? []).toContain(PIPELINE_STAGE_MULTI);
    expect(leftPaneTreeRowIds(view.monitorStates.at(-1))).toContain("run-implement");

    view.selectNode("run-orphan");
    await flush();
    expect(leftPaneTreeRowIds(view.monitorStates.at(-1))).toContain("run-implement");

    view.selectNode(PIPELINE_STAGE_MULTI);
    await flush();
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe(PIPELINE_STAGE_MULTI);
    expect(leftPaneTreeRowIds(view.monitorStates.at(-1))).toContain("run-implement");

    await view.toggleExpansion();
    expect(view.monitorStates.at(-1)?.expandedPipelineNodeIds ?? []).not.toContain(PIPELINE_STAGE_MULTI);
    expect(leftPaneTreeRowIds(view.monitorStates.at(-1))).not.toContain("run-implement");

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
    await view.toggleExpansion();
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
    await view.toggleExpansion();
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

    await view.toggleExpansion();
    view.selectNode("run-review");
    await flush();
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe("run-review");
    const before = [...(view.monitorStates.at(-1)?.expandedPipelineNodeIds ?? [])].sort();

    await view.toggleExpansion();
    expect([...(view.monitorStates.at(-1)?.expandedPipelineNodeIds ?? [])].sort()).toEqual(before);

    view.quit();
    expect(await pending).toBe(0);
  });

  test("reachable daemon proves health and status, enters the monitor on one open client, and exits 0 on quit", async () => {
    const view = createViewHost();
    const refresh = createIntervalScheduler();
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
    expect(clientOptions.methods).toEqual(["health", "status", "list", "pipeline_list", "close"]);
    expect(view.monitorStates[0]).toMatchObject({
      runs: [RUN_ALPHA],
      selectedNodeId: "run-alpha",
    });
    expect(view.isClosed()).toBe(true);
    expect(refresh.isClosed()).toBe(true);
  });

  test("monitor session issues no wait RPC", async () => {
    const view = createViewHost();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_ALPHA, RUN_BETA] }],
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    view.selectNode("run-beta");
    await flush();
    view.selectNode("run-alpha");
    await flush();
    view.quit();
    await pending;

    expect(clientOptions.methods?.some((method) => method.startsWith("wait:"))).toBe(false);
    expect(clientOptions.methods).toEqual(["health", "status", "list", "pipeline_list", "close"]);
  });

  test("successful resume does not re-issue wait", async () => {
    const view = createViewHost();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_ALPHA] }],
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    view.resumeSelected();
    await flush();
    view.quit();
    await pending;

    expect(clientOptions.methods).toContain("resume:run-alpha");
    expect(clientOptions.methods?.some((method) => method.startsWith("wait:"))).toBe(false);
  });

  test("terminal-first daemon order selects the topmost active run", async () => {
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

    expect(clientOptions.methods).toEqual(["health", "status", "list", "pipeline_list", "close"]);
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
      steeringFeedback: null,
      expandedPipelineNodeIds: [],
      commandBuffer: "",
      commandCursor: 0,
      focus: "tree",
      lastCommandResult: null,
      lastRpcError: null,
      machineProfile: "unknown",
      keyedSocketDigest: "unknown",
      refreshIntervalLabel: "1s",
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [] } },
      actionableRunIds: [],
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
    expect(clientOptions.methods).toEqual(["health", "status", "list", "pipeline_list", "close"]);
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
    expect(clientOptions.methods).toEqual(["health", "status", "list", "pipeline_list", "close"]);
  });

  test("drives row navigation through the injected input hook", async () => {
    // Mutation checkpoint: selection-driven list collapse during the ↑ walk must turn this pin RED.
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
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe("run-matched");

    view.selectPreviousRun();
    await flush();
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe(PIPELINE_STAGE_ALPHA);

    view.selectPreviousRun();
    await flush();
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe("pipe-alpha");

    view.quit();
    expect(await pending).toBe(0);
  });

  test("aligns selectable node ids with left-pane tree rows for the measured terminal size", async () => {
    // Mutation checkpoint: currentState lacking measured terminalColumns/terminalRows when selectNextRun/selectPreviousRun call monitorSelectableNodeIds must turn this pin RED.
    const view = createViewHost();
    const { deps, terminalColumns, terminalRows, maxVisibleRows, pipelineCount, pipelines } =
      overflowPipelineEntryDeps(view);

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();

    const assertMeasuredTerminal = (): void => {
      const state = view.monitorStates.at(-1);
      expect(state?.terminalColumns).toBe(terminalColumns);
      expect(state?.terminalRows).toBe(terminalRows);
      // Mutation checkpoint: requiring every monitorSelectableNodeIds entry in painted rows must turn this pin RED.
      // Mutation checkpoint: dropping withMeasuredTerminal from setState in tui-entry.tsx leaves
      // currentState on the 245x72 fallback, so ids are derived for a pane the shell never paints.
    };

    const initialState = view.monitorStates.at(-1);
    if (!initialState) throw new Error("expected initial monitor state");
    const initialLayout = computeShellLayout(terminalColumns, terminalRows, 0);
    const { treeRows: initialPaintedTreeRows } = monitorLeftPaneTreeRows(
      initialState,
      initialLayout,
      WORKFLOW_FILTER_NOW_MS,
    );
    expect(initialPaintedTreeRows.length).toBeLessThanOrEqual(maxVisibleRows);
    expect(initialPaintedTreeRows.filter((row) => row.kind === "pipeline").map((row) => row.id)).toEqual(
      [...pipelines]
        .reverse()
        .slice(0, initialPaintedTreeRows.length)
        .map((pipeline) => pipeline.pipelineId),
    );

    const initialSelected = initialState.selectedNodeId;
    expect(initialSelected).not.toBeNull();
    if (initialSelected !== null) {
      expect(leftPaneTreeRowIds(initialState)).toContain(initialSelected);
    }
    const selectableIds = monitorSelectableNodeIds(initialState, WORKFLOW_FILTER_NOW_MS);
    expect(selectableIds.some((id) => !leftPaneTreeRowIds(initialState).includes(id))).toBe(true);

    assertMeasuredTerminal();
    const visitedForward = new Set<string>();
    for (let step = 0; step < pipelineCount * 4; step += 1) {
      const before = view.monitorStates.at(-1)?.selectedNodeId ?? null;
      if (before !== null) visitedForward.add(before);
      view.selectNextRun();
      await flush();
      assertMeasuredTerminal();
      const after = view.monitorStates.at(-1)?.selectedNodeId ?? null;
      if (after === before) break;
    }
    expect(visitedForward.size).toBeGreaterThan(1);

    const visitedBackward = new Set<string>();
    for (let step = 0; step < pipelineCount * 4; step += 1) {
      const before = view.monitorStates.at(-1)?.selectedNodeId ?? null;
      if (before !== null) visitedBackward.add(before);
      view.selectPreviousRun();
      await flush();
      assertMeasuredTerminal();
      const after = view.monitorStates.at(-1)?.selectedNodeId ?? null;
      if (after === before) break;
    }
    expect(visitedBackward.size).toBeGreaterThan(1);

    view.quit();
    expect(await pending).toBe(0);
  });

  test("overflow fixture forward j then k retraces the exact reverse visit order", async () => {
    // Mutation checkpoint: reintroducing `ids[0]` fallthrough when `indexOf` is `-1` in selectNextRun/selectPreviousRun turns this pin RED.
    const view = createViewHost();
    const { deps, pipelineCount } = overflowPipelineEntryDeps(view);

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();

    const forwardOrder: string[] = [];
    const startId = view.monitorStates.at(-1)?.selectedNodeId;
    if (startId !== null && startId !== undefined) forwardOrder.push(startId);

    for (let step = 0; step < pipelineCount * 4; step += 1) {
      const before = view.monitorStates.at(-1)?.selectedNodeId ?? null;
      view.selectNextRun();
      await flush();
      const after = view.monitorStates.at(-1)?.selectedNodeId ?? null;
      if (after === before || after === null) break;
      forwardOrder.push(after);
    }
    expect(forwardOrder.length).toBeGreaterThan(1);

    const backwardOrder: string[] = [];
    for (let step = 0; step < pipelineCount * 4; step += 1) {
      const before = view.monitorStates.at(-1)?.selectedNodeId ?? null;
      view.selectPreviousRun();
      await flush();
      const after = view.monitorStates.at(-1)?.selectedNodeId ?? null;
      if (after === before || after === null) break;
      backwardOrder.push(after);
    }
    expect(backwardOrder).toEqual([...forwardOrder].slice(0, -1).toReversed());

    view.quit();
    expect(await pending).toBe(0);
  });

  test("j on the first painted pipeline row selects its first child, not ids[0] via fallthrough", async () => {
    // Mutation checkpoint: reintroducing `ids[0]` (and backward fallthrough) in selectNextRun/selectPreviousRun turns this pin RED.
    const view = createViewHost();
    const { deps } = pipelineTreeEntryDeps(view, {
      terminalSize: () => ({ columns: 80, rows: 24 }),
    });

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();

    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe("pipe-alpha");
    view.selectNextRun();
    await flush();
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe(PIPELINE_STAGE_ALPHA);

    view.quit();
    expect(await pending).toBe(0);
  });

  test("after each selectNextRun or selectPreviousRun, selectedNodeId stays in monitorSelectableNodeIds", async () => {
    const view = createViewHost();
    const { deps, pipelineCount } = overflowPipelineEntryDeps(view);

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();

    const assertMembership = (): void => {
      const state = view.monitorStates.at(-1);
      if (state === undefined) return;
      const selected = state.selectedNodeId;
      if (selected === null) return;
      expect(monitorSelectableNodeIds(state, WORKFLOW_FILTER_NOW_MS)).toContain(selected);
    };

    assertMembership();
    for (let step = 0; step < pipelineCount * 2; step += 1) {
      const before = view.monitorStates.at(-1)?.selectedNodeId ?? null;
      view.selectNextRun();
      await flush();
      assertMembership();
      if ((view.monitorStates.at(-1)?.selectedNodeId ?? null) === before) break;
    }
    for (let step = 0; step < pipelineCount * 2; step += 1) {
      const before = view.monitorStates.at(-1)?.selectedNodeId ?? null;
      view.selectPreviousRun();
      await flush();
      assertMembership();
      if ((view.monitorStates.at(-1)?.selectedNodeId ?? null) === before) break;
    }

    view.quit();
    expect(await pending).toBe(0);
  });

  test("j, k, and off-pane selectNode keep the selected tree row in the painted viewport", async () => {
    const view = createViewHost();
    const { deps, pipelineCount, pipelines } = overflowPipelineEntryDeps(view);

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();

    const assertPaintedTreeSelection = (): void => {
      const state = view.monitorStates.at(-1);
      const selected = state?.selectedNodeId;
      if (selected === null || selected === undefined) return;
      if (!selected.startsWith("pipe-")) return;
      expect(leftPaneTreeRowIds(state)).toContain(selected);
    };

    for (let step = 0; step < pipelineCount; step += 1) {
      view.selectNextRun();
      await flush();
      assertPaintedTreeSelection();
    }
    for (let step = 0; step < pipelineCount; step += 1) {
      view.selectPreviousRun();
      await flush();
      assertPaintedTreeSelection();
    }

    const offPanePipeline = pipelines[0];
    if (!offPanePipeline) throw new Error("expected an off-pane pipeline");
    const offPaneId = offPanePipeline.pipelineId;
    expect(leftPaneTreeRowIds(view.monitorStates.at(-1))).not.toContain(offPaneId);
    view.selectNode(offPaneId);
    await flush();
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe(offPaneId);
    expect(leftPaneTreeRowIds(view.monitorStates.at(-1))).toContain(offPaneId);

    view.quit();
    expect(await pending).toBe(0);
  });

  test("e on a selected stage returns left-pane tree row ids to their starting value after two presses", async () => {
    // Mutation checkpoint: short-circuiting stage e toggle or reintroducing selected-node self-expand in effective expansion must turn this pin RED.
    const view = createViewHost();
    const { deps } = pipelineMultiEntryDeps(view);

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();

    await view.toggleExpansion();
    view.selectNode(PIPELINE_STAGE_MULTI);
    await flush();
    const startingRowIds = leftPaneTreeRowIds(view.monitorStates.at(-1));

    await view.toggleExpansion();
    const intermediateRowIds = leftPaneTreeRowIds(view.monitorStates.at(-1));
    expect(intermediateRowIds).not.toEqual(startingRowIds);

    await view.toggleExpansion();
    expect(leftPaneTreeRowIds(view.monitorStates.at(-1))).toEqual(startingRowIds);

    view.quit();
    expect(await pending).toBe(0);
  });

  test("selecting attention preserves stored tree navigation state", async () => {
    // Mutation checkpoint: writing leftPaneTreeScrollOffset or expandedPipelineNodeIds on attention selection,
    // or suppressing steering-feedback clearing, must turn this pin RED.
    // @mutate v2/src/tui/tui-entry.tsx "selectedNodeId: nodeId,\n      steeringFeedback: null," -> "selectedNodeId: nodeId,\n      steeringFeedback: currentState.steeringFeedback,"
    const view = createViewHost();
    const { deps, pipelineCount } = attentionSelectionEntryDeps(view);

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();

    for (let step = 0; step < pipelineCount + 2; step += 1) {
      view.selectNextRun();
      await flush();
    }
    const lastTreeId = view.monitorStates.at(-1)?.selectedNodeId;
    if (typeof lastTreeId !== "string" || !lastTreeId.startsWith("pipe-")) {
      throw new Error("expected the walk to land on a pipeline row");
    }
    await view.toggleExpansion();
    const expandedBefore = view.monitorStates.at(-1)?.expandedPipelineNodeIds ?? [];
    expect(expandedBefore).toContain(lastTreeId);

    view.selectNode("run-attention-failed");
    await flush();
    view.pauseSelected();
    await flush();
    const beforeState = view.monitorStates.at(-1);
    if (beforeState === undefined) throw new Error("expected a painted monitor state");
    expect(beforeState.steeringFeedback).toBe("run_not_active: not active");
    const scrollOffsetBefore = beforeState.leftPaneTreeScrollOffset;

    const attentionId = monitorSelectableNodeIds(beforeState, WORKFLOW_FILTER_NOW_MS).find((id) =>
      id.startsWith("attention:"),
    );
    if (attentionId === undefined) throw new Error("expected an attention row id");

    view.selectNode(attentionId);
    await flush();
    const afterState = view.monitorStates.at(-1);

    // @mutate v2/src/tui/tui-entry.tsx "selectedNodeId: nodeId,\n      steeringFeedback: null,\n    });" -> "selectedNodeId: nodeId,\n      steeringFeedback: null,\n      expandedPipelineNodeIds: nodeId === null ? currentState.expandedPipelineNodeIds : [...(currentState.expandedPipelineNodeIds ?? []), nodeId],\n    });"
    expect(afterState?.selectedNodeId).toBe(attentionId);
    expect(afterState?.leftPaneTreeScrollOffset).toBe(scrollOffsetBefore);
    expect(afterState?.expandedPipelineNodeIds).toEqual(expandedBefore);
    expect(afterState?.steeringFeedback).toBeNull();

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

    // run-alpha is a running ad-hoc row with an earlier createdAt than pipe-alpha, so unified
    // running-rank ordering selects it first.
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe("run-alpha");
    expect(view.monitorStates.at(-1)?.selectedNodeId).not.toBe("pipe-alpha");

    view.quit();
    expect(await pending).toBe(0);
  });

  test("when a refresh drops the selected id from the selectable list, selectedNodeId clears", async () => {
    const view = createViewHost();
    const refresh = createIntervalScheduler();
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
    await view.toggleExpansion();
    view.selectNode(PIPELINE_STAGE_ALPHA);
    await flush();
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe(PIPELINE_STAGE_ALPHA);

    refresh.tick();
    await flush();
    await flush();

    expect(view.monitorStates.at(-1)?.selectedNodeId).toBeNull();
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
    await view.toggleExpansion();
    view.selectNode(PIPELINE_STAGE_ALPHA);
    await flush();
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe(PIPELINE_STAGE_ALPHA);
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
    await view.toggleExpansion();
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
    const refresh = createIntervalScheduler();
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
    const refresh = createIntervalScheduler();
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
  });

  test("refresh updates displayed status and liveness in place and keeps selection anchored", async () => {
    const view = createViewHost();
    const refresh = createIntervalScheduler();
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

  test("refresh clears selection when the selected run disappears", async () => {
    const view = createViewHost();
    const refresh = createIntervalScheduler();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_ALPHA] }, { runs: [RUN_BETA] }],
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

    expect(clientOptions.methods).toEqual([
      "health",
      "status",
      "list",
      "pipeline_list",
      "list",
      "pipeline_list",
      "close",
    ]);
    expect(view.monitorStates.at(-1)).toEqual({
      runs: [RUN_BETA],
      selectedNodeId: null,
      steeringFeedback: null,
      expandedPipelineNodeIds: [],
      leftPaneTreeScrollOffset: 0,
      commandBuffer: "",
      commandCursor: 0,
      focus: "tree",
      lastCommandResult: null,
      lastRpcError: null,
      machineProfile: "unknown",
      keyedSocketDigest: "unknown",
      refreshIntervalLabel: "1s",
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [] } },
      actionableRunIds: ["run-beta"],
    });
  });

  test("initial health and status RPC errors pass through as rpc-error and exit 1", async () => {
    const view = createViewHost();

    const unhealthy = await runTuiEntry({
      socketPath: "/tmp/test.sock",
      machineProfile: "test",
      admitDetachedPipelineStart: noopDetachedAdmission,
      viewHost: view.host,
      connectTuiDaemon: async () =>
        fakeClient({
          healthError: new RpcError("unhealthy", "daemon not ready"),
        }),
    });

    const unavailableStatus = await runTuiEntry({
      socketPath: "/tmp/test.sock",
      machineProfile: "test",
      admitDetachedPipelineStart: noopDetachedAdmission,
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
    // @mutate v2/src/tui/tui-entry.tsx "if (initial && allClientsFailed) throw firstError;" -> "if (initial && !allClientsFailed) throw firstError;"
    const feedbackStates: TuiViewState[] = [];
    let monitorOpened = false;
    const refresh = createIntervalScheduler();
    const viewHost: TuiViewHost = {
      show(state) {
        feedbackStates.push(state);
      },
      async openMonitor() {
        monitorOpened = true;
        return {
          update() {},
          async waitUntilExit() {},
          close() {},
        };
      },
    };

    const code = await runTuiEntry({
      socketPath: "/tmp/test.sock",
      machineProfile: "test",
      admitDetachedPipelineStart: noopDetachedAdmission,
      viewHost,
      refreshScheduler: refresh.scheduler,
      connectTuiDaemon: async () =>
        fakeClient({
          listError: new RpcConnectionError("malformed RPC reply: invalid list result"),
        }),
    });

    expect(code).toBe(1);
    expect(monitorOpened).toBe(false);
    expect(feedbackStates).toEqual([
      {
        kind: "rpc-error",
        code: "daemon_error",
        message: "malformed RPC reply: invalid list result",
      },
    ]);
  });

  test("refresh preserves selection changed while list is in flight", async () => {
    const view = createViewHost();
    const refresh = createIntervalScheduler();
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
      async pipelineApprove() {
        throw new Error("unexpected pipelineApprove");
      },
      async pipelineReject() {
        throw new Error("unexpected pipelineReject");
      },
      async pipelineResume() {
        throw new Error("unexpected pipelineResume");
      },
      async wait(runId) {
        return runId === "run-alpha" ? { runStatus: "completed" } : { runStatus: "blocked", iterationsConsumed: 3 };
      },
      close() {},
    };

    const pending = runTuiEntry({
      socketPath: "/tmp/test.sock",
      machineProfile: "test",
      admitDetachedPipelineStart: noopDetachedAdmission,
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
    expect(clientOptions.methods).toEqual(["health", "status", "list", "pipeline_list", "close"]);
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

  test("successful pause issues no wait RPC", async () => {
    const view = createViewHost();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_ALPHA] }],
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    view.pauseSelected();
    await flush();

    expect(clientOptions.methods?.some((method) => method.startsWith("wait:"))).toBe(false);
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

  test("rediscovery: a socket appearing after startup contributes runs on the next tick", async () => {
    const view = createViewHost();
    const refresh = createIntervalScheduler();
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
    const refresh = createIntervalScheduler();
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
    expect(view.monitorStates.at(-1)?.runs.map((r) => r.runId)).toEqual(["run-alpha", "run-beta"]);

    view.quit();
    await pending;
  });

  test("rediscovery: a disconnected socket's retained snapshot is evicted before the next merge", async () => {
    // A vanished daemon's last-observed snapshot must not outlive its client; otherwise a stale
    // terminal snapshot could outrank a still-live daemon's running one in the next merge.
    const view = createViewHost();
    const refresh = createIntervalScheduler();
    let discoveryPhase = 0;

    const daemon1Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [] }, { runs: [] }],
      pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_ALPHA] }],
    };
    const daemon2Options: FakeClientOptions = {
      methods: [],
      listResponses: [{ runs: [] }],
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
            return [DAEMON1_SOCKET, DAEMON2_SOCKET];
          }
          return [DAEMON1_SOCKET];
        },
      },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    expect(view.monitorStates.at(-1)?.pipelineSnapshotsBySocketPath?.[DAEMON2_SOCKET]).toEqual({
      pipelines: [PIPELINE_SNAPSHOT_BETA],
    });

    refresh.tick();
    await flush();
    await flush();
    await flush();

    expect(view.monitorStates.at(-1)?.pipelineSnapshotsBySocketPath?.[DAEMON2_SOCKET]).toBeUndefined();
    expect(view.monitorStates.at(-1)?.pipelineSnapshotsBySocketPath?.[DAEMON1_SOCKET]).toEqual({
      pipelines: [PIPELINE_SNAPSHOT_ALPHA],
    });

    view.quit();
    await pending;
  });

  test("rediscovery: superseded and superseding daemons render together while both are live", async () => {
    const view = createViewHost();
    const refresh = createIntervalScheduler();
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
    const refresh = createIntervalScheduler();
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
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBe("run-beta");
    view.quit();
    await pending;
  });

  test("rediscovery: selection clears when the owning daemon drops a selected pipeline", async () => {
    const view = createViewHost();
    const refresh = createIntervalScheduler();
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

    // Unlike runs (retained via lastGoodListBySocketPath), pipeline snapshots are evicted when
    // their socket disconnects, so the selected pipeline disappears and selection clears.
    refresh.tick();
    await flush();
    await flush();
    await flush();
    expect(view.monitorStates.at(-1)?.selectedNodeId).toBeNull();
    view.quit();
    await pending;
  });

  test("rediscovery: steering targets the daemon owning the selected run after supersession", async () => {
    const view = createViewHost();
    const refresh = createIntervalScheduler();
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
    const refresh = createIntervalScheduler();
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

  test("rediscovery: invoking socket list failure retains rows while replacing the stale client", async () => {
    const view = createViewHost();
    const refresh = createIntervalScheduler();

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
    expect(afterFailureState?.runs.map((run) => run.runId)).toEqual(["run-alpha"]);
    expect(afterFailureState?.lastRpcError).toBe("daemon_error: connection reset");

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
    const refresh = createIntervalScheduler();
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
    await flushIntervalTick(refresh);

    expect(countRpcMethod(client1Options.methods, "list")).toBe(2);
    expect(countRpcMethod(client2Options.methods, "list")).toBe(2);
    expect(countRpcMethod(client1Options.methods, "pipeline_list")).toBe(2);
    expect(countRpcMethod(client2Options.methods, "pipeline_list")).toBe(2);

    view.quit();
    await pending;
  });

  test("pipeline_list updates monitor state when list rows are unchanged", async () => {
    const view = createViewHost();
    const refresh = createIntervalScheduler();

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

    await flushIntervalTick(refresh);

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
    const refresh = createIntervalScheduler();
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

    await flushIntervalTick(refresh);

    expect(view.monitorStates.at(-1)?.pipelineSnapshotsBySocketPath?.["/tmp/test.sock"]).toEqual({
      pipelines: [PIPELINE_SNAPSHOT_ALPHA],
    });

    view.quit();
    await pending;
  });

  test("invoking-socket list failure evicts pipeline snapshots; non-evicting failures retain others", async () => {
    const view = createViewHost();
    const refresh = createIntervalScheduler();

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
    await flushIntervalTick(refresh);
    expect(view.monitorStates.at(-1)?.pipelineSnapshotsBySocketPath?.[DAEMON1_SOCKET]).toEqual({
      pipelines: [PIPELINE_SNAPSHOT_ALPHA],
    });
    expect(view.monitorStates.at(-1)?.pipelineSnapshotsBySocketPath?.[DAEMON2_SOCKET]).toEqual({
      pipelines: [PIPELINE_SNAPSHOT_BETA],
    });

    // Tick 2: non-invoking list fails on daemon2; daemon1 snapshot retained.
    await flushIntervalTick(refresh);
    expect(view.monitorStates.at(-1)?.pipelineSnapshotsBySocketPath?.[DAEMON1_SOCKET]).toEqual({
      pipelines: [PIPELINE_SNAPSHOT_ALPHA],
    });
    expect(view.monitorStates.at(-1)?.pipelineSnapshotsBySocketPath?.[DAEMON2_SOCKET]).toEqual({
      pipelines: [PIPELINE_SNAPSHOT_BETA],
    });
    expect(client2Options.methods).toContain("pipeline_list");

    // Tick 3: invoking-socket list fails on daemon1; both last-good snapshots remain retained.
    await flushIntervalTick(refresh);
    expect(view.monitorStates.at(-1)?.pipelineSnapshotsBySocketPath?.[DAEMON1_SOCKET]).toEqual({
      pipelines: [PIPELINE_SNAPSHOT_ALPHA],
    });
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
    const refresh = createIntervalScheduler();

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

    await flushIntervalTick(refresh);

    expect(view.monitorStates.at(-1)?.pipelineSnapshotsBySocketPath?.["/tmp/test.sock"]).toEqual({ pipelines: [] });

    view.quit();
    await pending;
  });

  test("display tick advances running work but not parked work without additional list or pipeline_list RPC", async () => {
    const view = createViewHost();
    const refresh = createIntervalScheduler();
    const displayTick = createIntervalScheduler();
    const runStartMs = 1_700_000_000_000;
    let nowMs = runStartMs + 60_000;
    const run = {
      ...PIPELINE_RUN_MATCHED,
      createdAt: runStartMs,
    };
    const runningStage = PIPELINE_SNAPSHOT_ALPHA.stages[0];
    const parkedStage = PIPELINE_SNAPSHOT_BETA.stages[0];
    if (runningStage === undefined || parkedStage === undefined) throw new Error("expected fixture stages");
    const runningSnapshot: PipelineSnapshot = {
      ...PIPELINE_SNAPSHOT_ALPHA,
      createdAt: runStartMs,
      stages: [{ ...runningStage, startedAt: runStartMs }],
    };
    const parkedSnapshot: PipelineSnapshot = {
      ...PIPELINE_SNAPSHOT_BETA,
      pipelineId: "pipe-parked",
      state: "pending",
      finishedAtMs: null,
      createdAt: runStartMs - 600_000,
      stages: [
        {
          ...parkedStage,
          workflowInvocationId: null,
          startedAt: runStartMs - 120_000,
          endedAt: runStartMs - 60_000,
        },
      ],
    };
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [run] }],
        pipelineListResponses: [{ pipelines: [runningSnapshot, parkedSnapshot] }],
      },
      {
        viewHost: view.host,
        refreshScheduler: refresh.scheduler,
        displayTickScheduler: displayTick.scheduler,
        nowMs: () => nowMs,
      },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();

    view.selectNode("pipe-alpha");
    await flush();
    await view.toggleExpansion();
    view.selectNode(PIPELINE_STAGE_ALPHA);
    await flush();
    await view.toggleExpansion();
    await flush();

    const listCountBefore = countRpcMethod(clientOptions.methods, "list");
    const pipelineListCountBefore = countRpcMethod(clientOptions.methods, "pipeline_list");
    const elapsedBefore = elapsedCellForRun(view.monitorStates.at(-1), "run-matched", nowMs);
    expect(elapsedBefore).toBe(formatElapsedWallClock(runStartMs, null, nowMs));
    const runningBefore = timingCellForPipeline(view.monitorStates.at(-1), "pipe-alpha", nowMs);
    const parkedBefore = timingCellForPipeline(view.monitorStates.at(-1), "pipe-parked", nowMs);
    // The fixture's real left-pane width (~94 columns) stays below the 100-column labeled-form floor,
    // so this asserts the compact `w<duration>/i<duration>` cell that actually paints at ordinary widths.
    expect(runningBefore).toBe("w1m");
    expect(parkedBefore).toBe("w1m/i2m");

    nowMs += 60_000;
    // Mutation checkpoint: calling refreshRuns or list/pipeline_list from the display-tick callback must turn display-tick/no-RPC RED.
    const statesBeforeTick = view.monitorStates.length;
    await flushIntervalTick(displayTick);
    expect(view.monitorStates.length).toBeGreaterThan(statesBeforeTick);

    expect(countRpcMethod(clientOptions.methods, "list")).toBe(listCountBefore);
    expect(countRpcMethod(clientOptions.methods, "pipeline_list")).toBe(pipelineListCountBefore);
    const elapsedAfter = elapsedCellForRun(view.monitorStates.at(-1), "run-matched", nowMs);
    expect(elapsedAfter).toBe(formatElapsedWallClock(runStartMs, null, nowMs));
    expect(elapsedAfter).not.toBe(elapsedBefore);
    const runningAfter = timingCellForPipeline(view.monitorStates.at(-1), "pipe-alpha", nowMs);
    const parkedAfter = timingCellForPipeline(view.monitorStates.at(-1), "pipe-parked", nowMs);
    expect(runningAfter).toBe("w2m");
    expect(runningAfter).not.toBe(runningBefore);
    expect(parkedAfter).toBe("w1m/i3m");

    view.quit();
    await pending;
  });

  test("typed log opens log follow when selectedRunIdFromState is set", async () => {
    const view = createViewHost();
    let followedRunId: string | undefined;
    let followDeps: { socketPath: string; socketDiscovery?: () => Promise<string[]> } | undefined;
    const { deps } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: pipelineTreeListFixture() }],
        pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_ALPHA] }],
      },
      {
        viewHost: view.host,
        nowMs: () => WORKFLOW_FILTER_NOW_MS,
        socketDiscovery: async () => ["/tmp/discovered.sock"],
        runTuiLogFollow: async (runId, logDeps) => {
          followedRunId = runId;
          followDeps = logDeps;
          return 0;
        },
      },
    );

    const pending = runTuiEntry(deps);

    await view.waitUntilOpen();
    await flush();
    await expandPipelineAndSelect(view, "pipe-alpha", "run-matched");
    view.focusCommand();
    view.insertCommandText("log");
    view.submitCommand("log");
    await flush();

    expect(view.isClosed()).toBe(true);
    expect(await pending).toBe(0);
    expect(followedRunId).toBe("run-matched");
    expect(followDeps?.socketPath).toBe("/tmp/test.sock");
    expect(followDeps?.socketDiscovery).toBe(deps.socketDiscovery);
  });

  test("typed log tears down monitor before entering log follow", async () => {
    const view = createViewHost();
    const refresh = createIntervalScheduler();
    const displayTick = createIntervalScheduler();
    const followGate = deferred<void>();
    const { deps } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: pipelineTreeListFixture() }],
        pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_ALPHA] }],
      },
      {
        viewHost: view.host,
        nowMs: () => WORKFLOW_FILTER_NOW_MS,
        refreshScheduler: refresh.scheduler,
        displayTickScheduler: displayTick.scheduler,
        runTuiLogFollow: async () => {
          expect(view.isClosed()).toBe(true);
          expect(refresh.isClosed()).toBe(true);
          expect(displayTick.isClosed()).toBe(true);
          await followGate.promise;
          return 0;
        },
      },
    );

    const pending = runTuiEntry(deps);

    await view.waitUntilOpen();
    await flush();
    await expandPipelineAndSelect(view, "pipe-alpha", "run-matched");
    view.focusCommand();
    view.insertCommandText("log");
    view.submitCommand("log");
    await flush();

    expect(view.isClosed()).toBe(true);
    expect(refresh.isClosed()).toBe(true);
    expect(displayTick.isClosed()).toBe(true);

    followGate.resolve();
    expect(await pending).toBe(0);
  });

  test("typed log with no run selected reports no_selection and does not enter log follow", async () => {
    const view = createViewHost();
    let logFollowCalls = 0;
    const pending = runTuiEntry(
      entryDeps(
        { methods: [], listResponses: [{ runs: [] }], pipelineListResponses: [{ pipelines: [] }] },
        {
          viewHost: view.host,
          nowMs: () => WORKFLOW_FILTER_NOW_MS,
          runTuiLogFollow: async () => {
            logFollowCalls += 1;
            return 0;
          },
        },
      ).deps,
    );
    await view.waitUntilOpen();
    await flush();
    dockCommandFailureAsserter(view, "log")("no_selection");
    expect(logFollowCalls).toBe(0);
    view.quit();
    expect(await pending).toBe(0);
  });

  test("typed log on pipeline or stage selection reports not_a_run and does not enter log follow", async () => {
    // @mutate v2/src/tui/tui-entry.tsx "if (selectedRunIdFromState(state) === null) return \"not_a_run\";" -> "if (selectedRunIdFromState(state) !== null) return \"not_a_run\";"
    const view = createViewHost();
    let logFollowCalls = 0;
    const { deps } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: pipelineTreeListFixture() }],
        pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_ALPHA] }],
      },
      {
        viewHost: view.host,
        nowMs: () => WORKFLOW_FILTER_NOW_MS,
        runTuiLogFollow: async () => {
          logFollowCalls += 1;
          return 0;
        },
      },
    );
    const pending = runTuiEntry(deps);

    try {
      await view.waitUntilOpen();
      await flush();

      const expectLogFailure = dockCommandFailureAsserter(view, "log");

      expectLogFailure("not_a_run", () => {
        view.selectNode("pipe-alpha");
      });
      expect(logFollowCalls).toBe(0);

      await expandPipelineAndSelect(view, "pipe-alpha", PIPELINE_STAGE_ALPHA);
      expectLogFailure("not_a_run");
      expect(logFollowCalls).toBe(0);
    } finally {
      view.quit();
    }
    expect(await pending).toBe(0);
  });

  test("typed kill pause and resume-run steer the selected live run", async () => {
    const view = createViewHost();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: pipelineTreeListFixture() }],
        pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_ALPHA] }],
        waitImpl: async () => ({ runStatus: "completed" }),
      },
      { viewHost: view.host, nowMs: () => WORKFLOW_FILTER_NOW_MS },
    );

    const pending = runTuiEntry(deps);

    try {
      await view.waitUntilOpen();
      await flush();
      await expandPipelineAndSelect(view, "pipe-alpha", "run-matched");
      for (const verb of ["pause", "kill", "resume-run"] as const) {
        view.focusCommand();
        while ((view.monitorStates.at(-1)?.commandBuffer ?? "").length > 0) {
          view.deleteCommandBackward();
        }
        view.insertCommandText(verb);
        view.submitCommand(verb);
        await flush();
      }
      expect(countRpcMethod(clientOptions.methods, "pause:", true)).toBe(1);
      expect(countRpcMethod(clientOptions.methods, "kill:", true)).toBe(1);
      expect(countRpcMethod(clientOptions.methods, "resume:", true)).toBe(1);
    } finally {
      view.quit();
    }
    expect(await pending).toBe(0);
  });

  test("typed resume-run issues a resume RPC and no wait RPC", async () => {
    const view = createViewHost();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: pipelineTreeListFixture() }],
        pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_ALPHA] }],
      },
      { viewHost: view.host, nowMs: () => WORKFLOW_FILTER_NOW_MS },
    );

    const pending = runTuiEntry(deps);

    try {
      await view.waitUntilOpen();
      await flush();
      await expandPipelineAndSelect(view, "pipe-alpha", "run-matched");
      view.focusCommand();
      view.insertCommandText("resume-run");
      view.submitCommand("resume-run");
      await flush();
      expect(clientOptions.methods).toContain("resume:run-matched");
      expect(clientOptions.methods?.some((method) => method.startsWith("wait:"))).toBe(false);
    } finally {
      view.quit();
    }
    expect(await pending).toBe(0);
  });

  test("typed run steering on ineligible selection reports feedback and issues no RPC", async () => {
    // @mutate v2/src/tui/tui-entry.tsx "if (method !== \"resume\" && !isLiveRunSteerable(currentState, runId))" -> "if (method !== \"resume\" && isLiveRunSteerable(currentState, runId))"
    const emptyView = createViewHost();
    const emptyPending = runTuiEntry(
      entryDeps(
        { methods: [], listResponses: [{ runs: [] }], pipelineListResponses: [{ pipelines: [] }] },
        { viewHost: emptyView.host, nowMs: () => WORKFLOW_FILTER_NOW_MS },
      ).deps,
    );
    await emptyView.waitUntilOpen();
    await flush();
    emptyView.focusCommand();
    emptyView.insertCommandText("kill");
    emptyView.submitCommand("kill");
    expect(emptyView.monitorStates.at(-1)?.lastCommandResult).toBe("no_selection");
    emptyView.quit();
    expect(await emptyPending).toBe(0);

    const terminalMatchedRun: DaemonListRunRow = {
      ...PIPELINE_RUN_MATCHED,
      status: "completed",
      isLive: false,
      finishedAtMs: TERMINAL_LIST_FINISH_MS,
    };
    const view = createViewHost();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [terminalMatchedRun, PIPELINE_RUN_ORPHAN] }],
        pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_ALPHA] }],
        waitImpl: async () => ({ runStatus: "completed" }),
      },
      { viewHost: view.host, nowMs: () => WORKFLOW_FILTER_NOW_MS },
    );
    const pending = runTuiEntry(deps);

    try {
      await view.waitUntilOpen();
      await flush();
      const expectKillFailure = steeringFailureAsserter(view, clientOptions, "kill", "kill:", true);
      const expectPauseFailure = steeringFailureAsserter(view, clientOptions, "pause", "pause:", true);

      view.selectNode("pipe-alpha");
      expectKillFailure("stale_non_expandable");

      await expandPipelineAndSelect(view, "pipe-alpha", PIPELINE_STAGE_ALPHA);
      expectKillFailure("stale_non_expandable");

      view.selectNode("run-orphan");
      expectKillFailure("unattributed");

      await expandPipelineAndSelect(view, "pipe-alpha", "run-matched");
      expectKillFailure("not_live_run");

      expectPauseFailure("not_live_run");

      const runIdSpy = spyOn(tuiEntry, "selectedRunIdFromState").mockReturnValue(null);
      try {
        const expectResumeRunFailure = steeringFailureAsserter(view, clientOptions, "resume-run", "resume:", true);
        expectKillFailure("stale_non_expandable");
        expectPauseFailure("stale_non_expandable");
        expectResumeRunFailure("stale_non_expandable");
      } finally {
        runIdSpy.mockRestore();
      }

      view.focusCommand();
      while ((view.monitorStates.at(-1)?.commandBuffer ?? "").length > 0) {
        view.deleteCommandBackward();
      }
      view.insertCommandText("resume-run");
      const resumeBuffer = view.monitorStates.at(-1)?.commandBuffer ?? "";
      const resumeBefore = countRpcMethod(clientOptions.methods, "resume:", true);
      view.submitCommand(resumeBuffer);
      await flush();
      expect(countRpcMethod(clientOptions.methods, "resume:", true)).toBe(resumeBefore + 1);
    } finally {
      view.quit();
    }
    expect(await pending).toBe(0);
  });

  test("typed run steering works during pending pipeline admission", async () => {
    const view = createViewHost();
    const admissionGate = deferred<PipelineStartAdmissionResult>();
    let admissionCalls = 0;
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: pipelineTreeListFixture() }],
        pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_ALPHA] }],
      },
      {
        viewHost: view.host,
        nowMs: () => WORKFLOW_FILTER_NOW_MS,
        admitDetachedPipelineStart: async () => {
          admissionCalls += 1;
          return admissionGate.promise;
        },
      },
    );
    const pending = runTuiEntry(deps);

    try {
      await view.waitUntilOpen();
      await flush();
      view.focusCommand();
      view.insertCommandText("start demo --seed-text pending");
      const startBuffer = view.monitorStates.at(-1)?.commandBuffer ?? "";
      view.submitCommand(startBuffer);
      expect(admissionCalls).toBe(1);

      await expandPipelineAndSelect(view, "pipe-alpha", "run-matched");
      view.focusCommand();
      while ((view.monitorStates.at(-1)?.commandBuffer ?? "").length > 0) {
        view.deleteCommandBackward();
      }
      view.insertCommandText("pause");
      view.submitCommand("pause");
      await flush();
      expect(countRpcMethod(clientOptions.methods, "pause:", true)).toBe(1);

      const expectKillFailure = steeringFailureAsserter(view, clientOptions, "kill", "kill:", true);
      view.selectNode("pipe-alpha");
      expectKillFailure("stale_non_expandable");

      view.submitCommand(startBuffer);
      expect(admissionCalls).toBe(1);

      admissionGate.resolve({ kind: "admitted", pipelineId: "pipe-admitted" });
      await flush();
    } finally {
      view.quit();
    }
    expect(await pending).toBe(0);
  });

  test("typed approve issues pipeline_approve for the selected awaiting stage", async () => {
    const view = createViewHost();
    const approveCalls: PipelineStageMutationParams[] = [];
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: awaitingPipelineListFixture() }],
        pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_AWAITING] }],
        pipelineApproveImpl: async (params) => {
          approveCalls.push(params);
          return { kind: "applied", pipelineId: params.pipelineId, stageId: params.stageId, decision: "approved" };
        },
      },
      { viewHost: view.host, nowMs: () => WORKFLOW_FILTER_NOW_MS },
    );
    const pending = runTuiEntry(deps);

    try {
      await view.waitUntilOpen();
      await flush();
      await expandPipelineAndSelect(view, "pipe-await", PIPELINE_STAGE_AWAITING);
      view.focusCommand();
      view.insertCommandText("approve");
      view.submitCommand("approve");
      await flush();
      expect(countRpcMethod(clientOptions.methods, "pipeline_approve")).toBe(1);
      expect(approveCalls).toEqual([{ pipelineId: "pipe-await", stageId: "gate", branchKey: "default" }]);
      expect(view.monitorStates.at(-1)).toMatchObject({
        lastCommandResult: "pipe-await",
        commandBuffer: "",
        commandCursor: 0,
        focus: "tree",
      });
    } finally {
      view.quit();
    }
    expect(await pending).toBe(0);
  });

  test("typed reject issues pipeline_reject for the selected awaiting stage", async () => {
    const view = createViewHost();
    const rejectCalls: PipelineStageMutationParams[] = [];
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: awaitingPipelineListFixture() }],
        pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_AWAITING] }],
        pipelineRejectImpl: async (params) => {
          rejectCalls.push(params);
          return { kind: "applied", pipelineId: params.pipelineId, stageId: params.stageId, decision: "rejected" };
        },
      },
      { viewHost: view.host, nowMs: () => WORKFLOW_FILTER_NOW_MS },
    );
    const pending = runTuiEntry(deps);

    try {
      await view.waitUntilOpen();
      await flush();
      await expandPipelineAndSelect(view, "pipe-await", PIPELINE_STAGE_AWAITING);
      view.focusCommand();
      view.insertCommandText("reject");
      view.submitCommand("reject");
      await flush();
      expect(countRpcMethod(clientOptions.methods, "pipeline_reject")).toBe(1);
      expect(rejectCalls).toEqual([{ pipelineId: "pipe-await", stageId: "gate", branchKey: "default" }]);
      expect(view.monitorStates.at(-1)).toMatchObject({
        lastCommandResult: "pipe-await",
        commandBuffer: "",
        commandCursor: 0,
        focus: "tree",
      });
    } finally {
      view.quit();
    }
    expect(await pending).toBe(0);
  });

  test("typed resume issues pipeline_resume for the selected non-terminal pipeline", async () => {
    const view = createViewHost();
    const resumeCalls: PipelineResumeParams[] = [];
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: pipelineTreeListFixture() }],
        pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_ALPHA] }],
        pipelineResumeImpl: async (params) => {
          resumeCalls.push(params);
          return { kind: "resumed", pipelineId: params.pipelineId };
        },
      },
      { viewHost: view.host, nowMs: () => WORKFLOW_FILTER_NOW_MS },
    );
    const pending = runTuiEntry(deps);

    try {
      await view.waitUntilOpen();
      await flush();
      view.selectNode("pipe-alpha");
      view.focusCommand();
      view.insertCommandText("resume");
      view.submitCommand("resume");
      await flush();
      expect(countRpcMethod(clientOptions.methods, "pipeline_resume")).toBe(1);
      expect(resumeCalls).toEqual([{ pipelineId: "pipe-alpha" }]);
      expect(view.monitorStates.at(-1)).toMatchObject({
        lastCommandResult: "pipe-alpha",
        commandBuffer: "",
        commandCursor: 0,
        focus: "tree",
      });
    } finally {
      view.quit();
    }
    expect(await pending).toBe(0);
  });

  test("typed approve on ineligible selection reports feedback and issues no RPC", async () => {
    // @mutate v2/src/tui/tui-entry.tsx "if (stage.status === \"awaiting\") return null;" -> "if (false) return null;"
    const emptyView = createViewHost();
    const emptyPending = runTuiEntry(
      entryDeps(
        { methods: [], listResponses: [{ runs: [] }], pipelineListResponses: [{ pipelines: [] }] },
        { viewHost: emptyView.host, nowMs: () => WORKFLOW_FILTER_NOW_MS },
      ).deps,
    );
    await emptyView.waitUntilOpen();
    await flush();
    emptyView.focusCommand();
    emptyView.insertCommandText("approve");
    emptyView.submitCommand("approve");
    expect(emptyView.monitorStates.at(-1)).toMatchObject({
      selectedNodeId: null,
      focus: "command",
      commandBuffer: "approve",
      lastCommandResult: "no_selection",
    });
    emptyView.quit();
    expect(await emptyPending).toBe(0);

    const view = createViewHost();
    const refresh = createIntervalScheduler();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [
          { runs: awaitingAndAlphaPipelineListFixture() },
          { runs: awaitingAndAlphaPipelineListFixture() },
        ],
        pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_AWAITING, PIPELINE_SNAPSHOT_ALPHA] }],
      },
      { viewHost: view.host, nowMs: () => WORKFLOW_FILTER_NOW_MS, refreshScheduler: refresh.scheduler },
    );
    wrapFailingSecondPipelineList(deps);
    const pending = runTuiEntry(deps);

    try {
      await view.waitUntilOpen();
      await flush();
      const expectApproveFailure = steeringFailureAsserter(view, clientOptions, "approve", "pipeline_approve");

      await expandPipelineAndSelect(view, "pipe-await", "run-await");
      expectApproveFailure("run_leaf");

      view.selectNode("run-orphan");
      expectApproveFailure("unattributed");

      view.selectNode("pipe-await");
      expectApproveFailure("not_awaiting_stage");

      await expandPipelineAndSelect(view, "pipe-alpha", PIPELINE_STAGE_ALPHA);
      expectApproveFailure("not_awaiting_stage");

      await flushIntervalTick(refresh);
      await expandPipelineAndSelect(view, "pipe-await", PIPELINE_STAGE_AWAITING);
      expectApproveFailure("stale_non_targetable");
    } finally {
      view.quit();
    }
    expect(await pending).toBe(0);
  });

  test("typed reject on ineligible selection reports feedback and issues no RPC", async () => {
    // @mutate v2/src/tui/tui-entry.tsx "if (stage.status === \"awaiting\") return null;" -> "if (false) return null;"
    const emptyView = createViewHost();
    const emptyPending = runTuiEntry(
      entryDeps(
        { methods: [], listResponses: [{ runs: [] }], pipelineListResponses: [{ pipelines: [] }] },
        { viewHost: emptyView.host, nowMs: () => WORKFLOW_FILTER_NOW_MS },
      ).deps,
    );
    await emptyView.waitUntilOpen();
    await flush();
    emptyView.focusCommand();
    emptyView.insertCommandText("reject");
    emptyView.submitCommand("reject");
    expect(emptyView.monitorStates.at(-1)?.lastCommandResult).toBe("no_selection");
    emptyView.quit();
    expect(await emptyPending).toBe(0);

    const view = createViewHost();
    const refresh = createIntervalScheduler();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [
          { runs: awaitingAndAlphaPipelineListFixture() },
          { runs: awaitingAndAlphaPipelineListFixture() },
        ],
        pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_AWAITING, PIPELINE_SNAPSHOT_ALPHA] }],
      },
      { viewHost: view.host, nowMs: () => WORKFLOW_FILTER_NOW_MS, refreshScheduler: refresh.scheduler },
    );
    wrapFailingSecondPipelineList(deps);
    const pending = runTuiEntry(deps);

    try {
      await view.waitUntilOpen();
      await flush();
      const expectRejectFailure = steeringFailureAsserter(view, clientOptions, "reject", "pipeline_reject");

      await expandPipelineAndSelect(view, "pipe-await", "run-await");
      expectRejectFailure("run_leaf");

      view.selectNode("run-orphan");
      expectRejectFailure("unattributed");

      view.selectNode("pipe-await");
      expectRejectFailure("not_awaiting_stage");

      await expandPipelineAndSelect(view, "pipe-alpha", PIPELINE_STAGE_ALPHA);
      expectRejectFailure("not_awaiting_stage");

      await flushIntervalTick(refresh);
      await expandPipelineAndSelect(view, "pipe-await", PIPELINE_STAGE_AWAITING);
      expectRejectFailure("stale_non_targetable");
    } finally {
      view.quit();
    }
    expect(await pending).toBe(0);
  });

  test("typed resume on ineligible selection reports feedback and issues no RPC", async () => {
    // @mutate v2/src/tui/tui-entry.tsx "if (isPipelineTerminal(pipeline.snapshot.state)) return \"terminal_pipeline\";" -> "if (false) return \"terminal_pipeline\";"
    const emptyView = createViewHost();
    const emptyPending = runTuiEntry(
      entryDeps(
        { methods: [], listResponses: [{ runs: [] }], pipelineListResponses: [{ pipelines: [] }] },
        { viewHost: emptyView.host, nowMs: () => WORKFLOW_FILTER_NOW_MS },
      ).deps,
    );
    await emptyView.waitUntilOpen();
    await flush();
    emptyView.focusCommand();
    emptyView.insertCommandText("resume");
    emptyView.submitCommand("resume");
    expect(emptyView.monitorStates.at(-1)?.lastCommandResult).toBe("no_selection");
    emptyView.quit();
    expect(await emptyPending).toBe(0);

    const view = createViewHost();
    const refresh = createIntervalScheduler();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: pipelineTreeListFixture() }, { runs: pipelineTreeListFixture() }],
        pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_ALPHA, PIPELINE_SNAPSHOT_BETA] }],
      },
      { viewHost: view.host, nowMs: () => WORKFLOW_FILTER_NOW_MS, refreshScheduler: refresh.scheduler },
    );
    wrapFailingSecondPipelineList(deps);
    const pending = runTuiEntry(deps);

    try {
      await view.waitUntilOpen();
      await flush();
      const expectResumeFailure = steeringFailureAsserter(view, clientOptions, "resume", "pipeline_resume");

      await expandPipelineAndSelect(view, "pipe-alpha", "run-matched");
      expectResumeFailure("run_leaf");

      view.selectNode("run-orphan");
      expectResumeFailure("unattributed");

      await expandPipelineAndSelect(view, "pipe-alpha", PIPELINE_STAGE_ALPHA);
      expectResumeFailure("not_pipeline");

      view.selectNode("pipe-beta");
      expectResumeFailure("terminal_pipeline");

      await flushIntervalTick(refresh);
      view.selectNode("pipe-alpha");
      expectResumeFailure("stale_non_targetable");
    } finally {
      view.quit();
    }
    expect(await pending).toBe(0);
  });

  test("attention commands act only on awaiting-gate pins", async () => {
    // Mutation checkpoint: reverting attention selection to the pre-fix tree-only resolution
    // (removing the attention-row branches added to approveRejectSelectionError and
    // resolvePipelineSteeringDispatch) makes this test fail, since the awaiting-gate row's
    // targetId is a stage row that is never itself selected here.
    // @mutate v2/src/tui/tui-entry.tsx "if (attentionRow.kind !== \"awaiting-gate\") return \"not_awaiting_stage\";" -> "if (false) return \"not_awaiting_stage\";"
    // @mutate v2/src/tui/tui-entry.tsx "if (attentionRow !== undefined && attentionRow.kind === \"awaiting-gate\" && attentionRow.gate !== undefined) {" -> "if (false) {"
    // @mutate v2/src/tui/tui-entry.tsx "      if (owner === undefined) return \"stale_non_targetable\";" -> "      if (false) return \"stale_non_targetable\";"
    const view = createViewHost();
    const refresh = createIntervalScheduler();
    const approveCalls: PipelineStageMutationParams[] = [];
    const rejectCalls: PipelineStageMutationParams[] = [];
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: attentionRunsFixture() }, { runs: attentionRunsFixture() }],
        pipelineListResponses: [
          { pipelines: [PIPELINE_SNAPSHOT_ATTENTION_GATES, PIPELINE_SNAPSHOT_ATTENTION_PUBLISHED] },
        ],
        pipelineApproveImpl: async (params) => {
          approveCalls.push(params);
          return { kind: "applied", pipelineId: params.pipelineId, stageId: params.stageId, decision: "approved" };
        },
        pipelineRejectImpl: async (params) => {
          rejectCalls.push(params);
          return { kind: "applied", pipelineId: params.pipelineId, stageId: params.stageId, decision: "rejected" };
        },
      },
      { viewHost: view.host, nowMs: () => WORKFLOW_FILTER_NOW_MS, refreshScheduler: refresh.scheduler },
    );
    wrapFailingSecondPipelineList(deps);
    const pending = runTuiEntry(deps);

    try {
      await view.waitUntilOpen();
      await flush();
      const expectApproveFailure = steeringFailureAsserter(view, clientOptions, "approve", "pipeline_approve");
      const expectRejectFailure = steeringFailureAsserter(view, clientOptions, "reject", "pipeline_reject");

      const initialState = view.monitorStates.at(-1);
      const awaitingGateId = attentionRowIdByKind(initialState, "awaiting-gate");
      const rejectedGateId = attentionRowIdByKind(initialState, "rejected-gate");
      const failedStageId = attentionRowIdByKind(initialState, "failed-stage");
      const failedRunId = attentionRowIdByKind(initialState, "failed-run");
      const blockedRunId = attentionRowIdByKind(initialState, "blocked-run");
      const publicationFailureId = attentionRowIdByKind(initialState, "publication-failure");

      for (const nonAwaitingId of [rejectedGateId, failedStageId, failedRunId, blockedRunId, publicationFailureId]) {
        view.selectNode(nonAwaitingId);
        expectApproveFailure("not_awaiting_stage");
        view.selectNode(nonAwaitingId);
        expectRejectFailure("not_awaiting_stage");
      }

      view.selectNode(awaitingGateId);
      view.focusCommand();
      view.insertCommandText("approve");
      view.submitCommand("approve");
      await flush();
      expect(countRpcMethod(clientOptions.methods, "pipeline_approve")).toBe(1);
      expect(approveCalls).toEqual([{ pipelineId: "pipe-attn-gates", stageId: "approve-plan", branchKey: "default" }]);
      expect(view.monitorStates.at(-1)).toMatchObject({
        lastCommandResult: "pipe-attn-gates",
        commandBuffer: "",
        commandCursor: 0,
        focus: "tree",
      });

      view.selectNode(awaitingGateId);
      view.focusCommand();
      view.insertCommandText("reject");
      view.submitCommand("reject");
      await flush();
      expect(countRpcMethod(clientOptions.methods, "pipeline_reject")).toBe(1);
      expect(rejectCalls).toEqual([{ pipelineId: "pipe-attn-gates", stageId: "approve-plan", branchKey: "default" }]);
      expect(view.monitorStates.at(-1)).toMatchObject({
        lastCommandResult: "pipe-attn-gates",
        commandBuffer: "",
        commandCursor: 0,
        focus: "tree",
      });

      await flushIntervalTick(refresh);
      view.selectNode(awaitingGateId);
      expectApproveFailure("stale_non_targetable");
      view.selectNode(awaitingGateId);
      expectRejectFailure("stale_non_targetable");
    } finally {
      view.quit();
    }
    expect(await pending).toBe(0);
  });

  test("typed approve daemon refusal retains command input and reports verbatim detail", async () => {
    await runAwaitingStageSteeringRefusalTest("approve", "pipelineApproveImpl");
  });

  test("typed reject daemon refusal retains command input and reports verbatim detail", async () => {
    await runAwaitingStageSteeringRefusalTest("reject", "pipelineRejectImpl");
  });

  test("typed resume daemon refusal retains command input and reports verbatim detail", async () => {
    const refusalDetail = "pipeline_not_found\n";
    const view = createViewHost();
    const { deps } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: pipelineTreeListFixture() }],
        pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_ALPHA] }],
        pipelineResumeImpl: async () =>
          ({
            kind: "refused",
            pipelineId: "pipe-alpha",
            reason: refusalDetail,
          }) as unknown as ResumePipelineOutcome,
      },
      { viewHost: view.host, nowMs: () => WORKFLOW_FILTER_NOW_MS },
    );
    const pending = runTuiEntry(deps);

    try {
      await view.waitUntilOpen();
      await flush();
      view.selectNode("pipe-alpha");
      view.focusCommand();
      view.insertCommandText("resume");
      const buffer = view.monitorStates.at(-1)?.commandBuffer ?? "";
      view.submitCommand(buffer);
      await flush();
      expect(view.monitorStates.at(-1)).toMatchObject({
        focus: "command",
        commandBuffer: buffer,
        lastCommandResult: refusalDetail,
      });
    } finally {
      view.quit();
    }
    expect(await pending).toBe(0);
  });

  test("suppresses stale pipeline mutation settlements", async () => {
    const view = createViewHost();
    const approveGate = deferred<PipelineApprovalDecisionOutcome>();
    const rejectGate = deferred<PipelineApprovalDecisionOutcome>();
    const resumeGate = deferred<ResumePipelineOutcome>();
    let approveCalls = 0;
    let rejectCalls = 0;
    let resumeCalls = 0;
    const { deps } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: awaitingPipelineListFixture() }, { runs: pipelineTreeListFixture() }],
        pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_AWAITING, PIPELINE_SNAPSHOT_ALPHA] }],
        pipelineApproveImpl: async () => {
          approveCalls += 1;
          return approveGate.promise;
        },
        pipelineRejectImpl: async () => {
          rejectCalls += 1;
          return rejectGate.promise;
        },
        pipelineResumeImpl: async () => {
          resumeCalls += 1;
          return resumeGate.promise;
        },
      },
      { viewHost: view.host, nowMs: () => WORKFLOW_FILTER_NOW_MS },
    );
    const pending = runTuiEntry(deps);

    try {
      await view.waitUntilOpen();
      await flush();

      await expandPipelineAndSelect(view, "pipe-await", PIPELINE_STAGE_AWAITING);
      view.focusCommand();
      view.insertCommandText("approve");
      const approveBuffer = view.monitorStates.at(-1)?.commandBuffer ?? "";
      view.submitCommand(approveBuffer);
      expect(approveCalls).toBe(1);
      view.insertCommandText("!");
      await flush();
      approveGate.resolve({
        kind: "applied",
        pipelineId: "pipe-await",
        stageId: "gate",
        decision: "approved",
      });
      await flush();
      expect(view.monitorStates.at(-1)).toMatchObject({
        commandBuffer: `${approveBuffer}!`,
        focus: "command",
        lastCommandResult: null,
      });

      await expandPipelineAndSelect(view, "pipe-await", PIPELINE_STAGE_AWAITING);
      view.focusCommand();
      while ((view.monitorStates.at(-1)?.commandBuffer ?? "").length > 0) {
        view.deleteCommandBackward();
      }
      view.insertCommandText("reject");
      const rejectBuffer = view.monitorStates.at(-1)?.commandBuffer ?? "";
      view.submitCommand(rejectBuffer);
      expect(rejectCalls).toBe(1);
      view.insertCommandText("!");
      await flush();
      rejectGate.resolve({
        kind: "applied",
        pipelineId: "pipe-await",
        stageId: "gate",
        decision: "rejected",
      });
      await flush();
      expect(view.monitorStates.at(-1)).toMatchObject({
        commandBuffer: `${rejectBuffer}!`,
        focus: "command",
        lastCommandResult: null,
      });

      view.selectNode("pipe-alpha");
      view.focusCommand();
      while ((view.monitorStates.at(-1)?.commandBuffer ?? "").length > 0) {
        view.deleteCommandBackward();
      }
      view.insertCommandText("resume");
      const resumeBuffer = view.monitorStates.at(-1)?.commandBuffer ?? "";
      view.submitCommand(resumeBuffer);
      expect(resumeCalls).toBe(1);
      view.insertCommandText("!");
      await flush();
      resumeGate.resolve({ kind: "resumed", pipelineId: "pipe-alpha" });
      await flush();
      expect(view.monitorStates.at(-1)).toMatchObject({
        commandBuffer: `${resumeBuffer}!`,
        focus: "command",
        lastCommandResult: null,
      });
    } finally {
      view.quit();
    }
    expect(await pending).toBe(0);

    const closeView = createViewHost();
    const closeGate = deferred<PipelineApprovalDecisionOutcome>();
    let closeApproveCalls = 0;
    const closePending = runTuiEntry(
      entryDeps(
        {
          methods: [],
          listResponses: [{ runs: awaitingPipelineListFixture() }],
          pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_AWAITING] }],
          pipelineApproveImpl: async () => {
            closeApproveCalls += 1;
            return closeGate.promise;
          },
        },
        { viewHost: closeView.host, nowMs: () => WORKFLOW_FILTER_NOW_MS },
      ).deps,
    );
    await closeView.waitUntilOpen();
    await flush();
    closeView.selectNode("pipe-await");
    await flush();
    const closeExpanded = closeView.monitorStates.at(-1)?.expandedPipelineNodeIds ?? [];
    if (!closeExpanded.includes("pipe-await")) {
      await closeView.toggleExpansion();
    }
    closeView.selectNode(PIPELINE_STAGE_AWAITING);
    await flush();
    closeView.focusCommand();
    closeView.insertCommandText("approve");
    const closeBuffer = closeView.monitorStates.at(-1)?.commandBuffer ?? "";
    closeView.submitCommand(closeBuffer);
    expect(closeApproveCalls).toBe(1);
    const statesBeforeClose = closeView.monitorStates.length;
    closeView.quit();
    closeGate.resolve({
      kind: "applied",
      pipelineId: "pipe-await",
      stageId: "gate",
      decision: "approved",
    });
    await flush();
    expect(closeView.monitorStates).toHaveLength(statesBeforeClose);
    expect(await closePending).toBe(0);
  });

  test("blocks second pipeline mutation while admission is pending", async () => {
    const view = createViewHost();
    const approveGate = deferred<PipelineApprovalDecisionOutcome>();
    let approveCalls = 0;
    const { deps } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: awaitingPipelineListFixture() }],
        pipelineListResponses: [{ pipelines: [PIPELINE_SNAPSHOT_AWAITING] }],
        pipelineApproveImpl: async () => {
          approveCalls += 1;
          return approveGate.promise;
        },
      },
      { viewHost: view.host, nowMs: () => WORKFLOW_FILTER_NOW_MS },
    );
    const pending = runTuiEntry(deps);

    try {
      await view.waitUntilOpen();
      await flush();
      await expandPipelineAndSelect(view, "pipe-await", PIPELINE_STAGE_AWAITING);
      view.focusCommand();
      view.insertCommandText("approve");
      const buffer = view.monitorStates.at(-1)?.commandBuffer ?? "";
      view.submitCommand(buffer);
      expect(approveCalls).toBe(1);
      view.submitCommand(buffer);
      expect(approveCalls).toBe(1);
      approveGate.resolve({
        kind: "applied",
        pipelineId: "pipe-await",
        stageId: "gate",
        decision: "approved",
      });
      await flush();
    } finally {
      view.quit();
    }
    expect(await pending).toBe(0);
  });
});
