import { describe, expect, spyOn, test } from "bun:test";
import { Box as InkBox, Text as InkText, renderToString } from "ink";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { PipelineSnapshot } from "../daemon/pipeline-observation.ts";
import { tuiRefreshIntervalLabel } from "./tui-entry.tsx";
import type { InkRender } from "./tui-ink-feedback.tsx";
import * as inkMonitor from "./tui-ink-monitor.tsx";
import {
  createMonitorDisplay,
  MonitorDock,
  MonitorLeftPane,
  MonitorRightPane,
  monitorLeftPaneContentRows,
  openInkMonitor,
} from "./tui-ink-monitor.tsx";
import type { InjectedInkUi, InkUseInput, InkUsePaste } from "./tui-ink-runtime.ts";
import { loadInkUi } from "./tui-ink-runtime.ts";
import { mergePipelineSnapshots, monitorDockLines } from "./tui-monitor-lines.ts";
import {
  buildMonitorPipelineTreeJoin,
  isExpandablePipelineNodeId,
  monitorPipelineBranchNodeId,
  monitorPipelineStageNodeId,
} from "./tui-monitor-pipeline-tree.ts";
import { TUI_TERMINAL_WINDOW_MS } from "./tui-monitor-terminal-window.ts";
import type { TuiMonitorControls, TuiMonitorSession, TuiMonitorState } from "./tui-monitor-types.ts";
import { computeShellLayout, MONITOR_TREE_NOT_LIVE_LABEL, nudgeDividerOffset } from "./tui-shell-layout.ts";

const TREE_NOW_MS = 1_700_000_000_000;

function implementStage(invocationId: string): PipelineSnapshot["stages"][number] {
  return {
    id: "stage-implement",
    stageId: "implement",
    branchKey: "default",
    position: 0,
    status: "running",
    workflowInvocationId: invocationId,
    startedAt: null,
    endedAt: null,
    decidedAt: null,
    artifact: null,
    failureDetail: null,
  };
}

function pipelineSnapshot(
  overrides: Partial<PipelineSnapshot> & Pick<PipelineSnapshot, "pipelineId">,
): PipelineSnapshot {
  return {
    name: "feature-pipeline",
    state: "running",
    createdAt: TREE_NOW_MS,
    finishedAtMs: null,
    stages: [],
    ...overrides,
    terminalPublicationSucceededAt: overrides.terminalPublicationSucceededAt ?? null,
    terminalPublicationFailure: overrides.terminalPublicationFailure ?? null,
  };
}

type TextCapture = { text: string; color?: string; inverse?: boolean };

function collectInkText(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectInkText).join("");
  if (typeof node !== "object") return "";
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  if ("props" in element) {
    return collectInkText(element.props?.children);
  }
  return "";
}

function collectTextNodes(node: unknown, TextType: unknown): TextCapture[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap((child) => collectTextNodes(child, TextType));
  if (typeof node !== "object") return [];
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  if (element.type === TextType) {
    const children = element.props?.children;
    const text = typeof children === "string" ? children : collectInkText(children);
    const color = element.props?.color;
    const inverse = element.props?.inverse;
    const capture: TextCapture = { text };
    if (typeof color === "string") capture.color = color;
    if (typeof inverse === "boolean") capture.inverse = inverse;
    return [capture];
  }
  if ("props" in element) {
    return collectTextNodes(element.props?.children, TextType);
  }
  return [];
}

function findRegion(node: unknown, Region: unknown): ReactElement | undefined {
  if (node === null || node === undefined || typeof node === "boolean") return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findRegion(child, Region);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof node !== "object") return undefined;
  const element = node as ReactElement;
  if (element.type === Region) return element;
  if ("props" in element) {
    return findRegion((element.props as { children?: unknown }).children, Region);
  }
  return undefined;
}

function regionBoxWidth(region: ReactElement | undefined): number | undefined {
  if (region === undefined) return undefined;
  const child = (region.props as { children?: ReactElement }).children;
  if (child === undefined || typeof child !== "object" || !("props" in child)) return undefined;
  const width = (child.props as { width?: number }).width;
  if (typeof width === "number") return width;
  if (Array.isArray(child)) {
    for (const entry of child) {
      if (typeof entry === "object" && entry !== null && "props" in entry) {
        const nested = (entry.props as { width?: number }).width;
        if (typeof nested === "number") return nested;
      }
    }
  }
  return undefined;
}

function dockRows(tree: unknown): { text: string; props: StubBoxProps }[] {
  const dock = findRegion(tree, MonitorDock);
  if (dock === undefined) throw new Error("expected dock");
  const dockBox = (dock.props as { children?: ReactElement }).children;
  if (dockBox === undefined || typeof dockBox !== "object" || !("props" in dockBox)) {
    throw new Error("expected dock box");
  }
  const children = (dockBox.props as { children?: unknown }).children;
  const rows = Array.isArray(children) ? children : children === undefined ? [] : [children];
  return rows.map((row) => {
    if (typeof row !== "object" || row === null || !("props" in row)) throw new Error("expected dock row");
    return { text: collectInkText(row), props: (row as ReactElement<StubBoxProps>).props };
  });
}

type StubBoxProps = {
  flexDirection?: "column" | "row";
  width?: number;
  height?: number;
  overflow?: "hidden" | "visible";
  children?: ReactNode;
};

function isMonitorRegion(node: unknown, Region: unknown): boolean {
  if (typeof node !== "object" || node === null) return false;
  return (node as { type?: unknown }).type === Region;
}

function paneContainerFlexDirection(tree: unknown, paneHeight: number): "column" | "row" | undefined {
  function walk(node: unknown): StubBoxProps | undefined {
    if (node === null || node === undefined || typeof node === "boolean") return undefined;
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = walk(child);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    if (typeof node !== "object") return undefined;
    const element = node as { type?: unknown; props?: StubBoxProps & { children?: unknown } };
    if (element.type === stubBox && element.props?.height === paneHeight) {
      const children = element.props.children;
      const childList = Array.isArray(children) ? children : children !== undefined ? [children] : [];
      if (
        childList.some((child) => isMonitorRegion(child, MonitorLeftPane)) &&
        childList.some((child) => isMonitorRegion(child, MonitorRightPane))
      ) {
        return element.props;
      }
    }
    if (element.props?.children !== undefined) {
      return walk(element.props.children);
    }
    return undefined;
  }
  return walk(tree)?.flexDirection;
}

function stubBox(props: {
  children?: ReactNode;
  flexDirection?: "column" | "row";
  width?: number;
  height?: number;
  overflow?: "hidden" | "visible";
}): ReactElement {
  return createElement("monitor-box", props, props.children);
}

function stubText(props: { children?: string; color?: string; inverse?: boolean }): ReactElement {
  const attrs: { color?: string; inverse?: boolean } = {};
  if (props.color !== undefined) attrs.color = props.color;
  if (props.inverse !== undefined) attrs.inverse = props.inverse;
  return createElement("monitor-text", Object.keys(attrs).length > 0 ? attrs : null, props.children);
}

function renderMonitorOutput(state: TuiMonitorState): string[] {
  const Text = (props: { children?: string; color?: string }) =>
    createElement(InkText, props.color === undefined ? null : { color: props.color }, props.children);
  const Box = ({ children, ...props }: StubBoxProps) => createElement(InkBox, props, children);
  return renderToString(createMonitorDisplay(state, Text, Box, TREE_NOW_MS), {
    columns: state.terminalColumns ?? 245,
  }).split("\n");
}

function shellState(
  runs: readonly DaemonListRunRow[],
  selectedNodeId: string | null,
  overrides: Partial<TuiMonitorState> = {},
): TuiMonitorState {
  return {
    runs,
    selectedNodeId,
    steeringFeedback: null,
    expandedPipelineNodeIds: [],
    terminalColumns: 245,
    terminalRows: 72,
    refreshIntervalLabel: tuiRefreshIntervalLabel(),
    ...overrides,
  };
}

// Ignores the real element openInkMonitor passes and rebuilds the tree via createMonitorDisplay
// instead: walking the actual element would invoke MonitorSessionRoot's useState/useInput outside
// a reconciler and throw. This proves createMonitorDisplay colors correctly and that renderFn was
// called, not that openInkMonitor renders this exact tree.
function createInkCapture(state: TuiMonitorState) {
  const renders: unknown[] = [];
  let TextType: unknown;
  let BoxType: unknown;
  const inkRender = ((_element: unknown) => {
    if (TextType === undefined) throw new Error("expected Text before render");
    renders.push(
      createMonitorDisplay(
        state,
        TextType as Parameters<typeof createMonitorDisplay>[1],
        BoxType as Parameters<typeof createMonitorDisplay>[2],
      ),
    );
    return {
      rerender() {},
      unmount() {},
      waitUntilExit: async () => {},
      cleanup() {},
      clear() {},
      waitUntilRenderFlush: async () => {},
    };
  }) as InkRender;

  return {
    inkRender,
    setTextType(Text: unknown) {
      TextType = Text;
    },
    setBoxType(Box: unknown) {
      BoxType = Box;
    },
    lastRender() {
      return renders.at(-1);
    },
  };
}

function noopControls(): TuiMonitorControls {
  return {
    focusCommand() {},
    focusTree() {},
    insertCommandText() {},
    moveCommandCursorLeft() {},
    moveCommandCursorRight() {},
    deleteCommandBackward() {},
    deleteCommandForward() {},
    submitCommand() {},
    async admitDetachedPipelineStart() {
      return { kind: "admitted", pipelineId: "noop-pipeline" };
    },
    selectNode() {},
    selectNextRun() {},
    selectPreviousRun() {},
    toggleSelectedWorkflowExpansion() {},
    pauseSelected() {},
    resumeSelected() {},
    killSelected() {},
    quit() {},
  };
}

function textNode(nodes: TextCapture[], text: string): TextCapture {
  const match = nodes.find((node) => node.text === text || node.text.trim() === text);
  if (match === undefined) throw new Error(`missing Text node: ${text}`);
  return match;
}

function inputHarness() {
  let inputHandler: Parameters<InkUseInput>[0] | undefined;
  let pasteHandler: Parameters<InkUsePaste>[0] | undefined;
  let instance: Awaited<ReturnType<InkRender>> | undefined;
  let renderOptions: Parameters<InkRender>[1] | undefined;
  const useInput: InkUseInput = (nextHandler) => {
    inputHandler = nextHandler;
  };
  const usePaste: InkUsePaste = (nextHandler) => {
    pasteHandler = nextHandler;
  };

  return {
    async injection(): Promise<InjectedInkUi> {
      const ink = await import("ink");
      return {
        renderFn: ((element: ReactElement, options) => {
          renderOptions = options;
          instance = ink.render(element, { exitOnCtrlC: false });
          return instance;
        }) as InkRender,
        Text: ({ children, color }) => createElement(ink.Text, color === undefined ? null : { color }, children),
        Box: ({ children, ...props }) => createElement(ink.Box, props, children),
        useInput,
        usePaste,
      };
    },
    async press(input: string, key: Parameters<Parameters<InkUseInput>[0]>[1] = {}) {
      if (inputHandler === undefined) throw new Error("expected input handler");
      inputHandler(input, key);
      if (instance === undefined) throw new Error("expected ink instance");
      await instance.waitUntilRenderFlush();
    },
    async paste(text: string) {
      if (pasteHandler === undefined) throw new Error("expected paste handler");
      pasteHandler(text);
      if (instance === undefined) throw new Error("expected ink instance");
      await instance.waitUntilRenderFlush();
    },
    renderOptions() {
      return renderOptions;
    },
  };
}

// The monitor colors cells by passing `color` to the Text the runtime hands back. The
// production wrapper previously destructured only `children`, so `color` never reached
// ink and the TUI rendered monochrome while every color test stayed green — those tests
// asserted against their own injected Text, not this one.
describe("loadInkUi production Text", () => {
  test("uses ink's input hook in production", async () => {
    const ink = await import("ink");
    const { useInput } = await loadInkUi();

    expect(useInput).toBe(ink.useInput);
  });

  test("forwards color to ink's Text and omits it for untoned segments", async () => {
    const { Text } = await loadInkUi();
    const toned = Text({ children: "failed", color: "red" });
    const untoned = Text({ children: "not-live" });

    expect(isValidElement(toned)).toBe(true);
    expect((toned.props as { color?: string }).color).toBe("red");
    expect((toned.props as { children?: unknown }).children).toBe("failed");
    expect((untoned.props as { color?: string }).color).toBeUndefined();
  });
});

describe("createMonitorDisplay", () => {
  test("split shell renders run rows left, detail right, and a four-line dock", async () => {
    // Mutation checkpoint: skip the `layoutMode` branch and always apply split widths in tui-ink-monitor.tsx.
    const state = shellState(
      [
        { runId: "run-alpha", project: "demo", branch: "alpha", createdAt: 0, status: "in-progress", isLive: true },
        { runId: "run-beta", project: "demo", branch: "beta", createdAt: 0, status: "completed", isLive: false },
      ],
      "run-alpha",
      {},
    );
    const tree = createMonitorDisplay(state, stubText, stubBox);

    const left = findRegion(tree, MonitorLeftPane);
    const right = findRegion(tree, MonitorRightPane);
    const dock = findRegion(tree, MonitorDock);
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    expect(dock).toBeDefined();

    const leftText = collectInkText(left);
    const rightText = collectInkText(right);
    const dockText = collectInkText(dock);

    expect(leftText).toContain("in-progress");
    expect(leftText).not.toContain("Outcome");
    expect(leftText).not.toContain("runStatus:");
    expect(rightText).toContain("Run");
    expect(rightText).toContain("status: in-progress");
    expect(rightText).toContain("runId: run-alpha");
    expect(rightText).not.toContain("run-beta");
    expect(dockText).toContain("1 running · 0 awaiting gate · 0 failed · 1 done · unknown@unknown · refresh 1s");
    expect(leftText).not.toContain("1 running · 0 awaiting gate · 0 failed · 1 done · unknown@unknown · refresh 1s");
    expect(rightText).not.toContain("1 running · 0 awaiting gate · 0 failed · 1 done · unknown@unknown · refresh 1s");
    expect(regionBoxWidth(left)).toBe(computeShellLayout(245, 72, 0).leftWidth);
  });

  test("paints only the four projected dock rows in split and stacked shells", () => {
    // @mutate v2/src/tui/tui-ink-monitor.tsx "if (Box === undefined) return rows;" -> "if (true) return rows;"
    const snapshot = pipelineSnapshot({ pipelineId: "pipeline-dock", stages: [implementStage("inv-dock")] });
    for (const terminalColumns of [120, 119]) {
      const state = shellState([], "pipeline-dock", {
        commandBuffer: "x".repeat(250),
        commandCursor: 100,
        machineProfile: "workstation",
        keyedSocketDigest: "0123456789abcdef",
        lastCommandResult: "ready",
        pipelineSnapshotsBySocketPath: { "/socket": { pipelines: [snapshot] } },
        terminalColumns,
      });
      const tree = createMonitorDisplay(state, stubText, stubBox, TREE_NOW_MS);
      const rows = dockRows(tree);

      expect(rows.map((row) => row.text)).toEqual(monitorDockLines(state));
      expect(rows).toHaveLength(4);
      expect(rows.every((row) => row.props.height === 1 && row.props.overflow === "hidden")).toBe(true);
      expect(rows[0]?.text).toStartWith("1 running · 0 awaiting gate · 0 failed · 0 done");
      expect(rows[1]?.text).toContain("▏");
      expect(rows[2]?.text).not.toBe("");
      expect(rows[3]?.text).toContain("e expand/collapse");
    }
  });

  test("renders empty and long input as four fixed physical dock rows in both shells", () => {
    for (const terminalColumns of [120, 119]) {
      for (const commandBuffer of ["", `${"x".repeat(terminalColumns * 3)}\nend`]) {
        const state = shellState([], null, {
          commandBuffer,
          commandCursor: commandBuffer.length,
          machineProfile: "profile",
          keyedSocketDigest: "digest",
          terminalColumns,
          terminalRows: 12,
        });
        const layout = computeShellLayout(terminalColumns, 12, 0);
        const output = renderMonitorOutput(state);
        const paintedDock = output.slice(layout.paneHeight);

        expect(output).toHaveLength(12);
        expect(paintedDock).toEqual(monitorDockLines(state));
        expect(paintedDock).toHaveLength(layout.dockHeight);
        expect(paintedDock.every((row) => Bun.stringWidth(row) <= terminalColumns)).toBe(true);
        expect(paintedDock.every((row) => !/\p{Cc}/u.test(row))).toBe(true);
      }
    }
  });

  test("stacked shell vertically stacks left and right panes below 120 columns", () => {
    // Mutation checkpoint: skip the `layoutMode === "stacked"` branch in tui-ink-monitor.tsx.
    const state = shellState(
      [{ runId: "run-alpha", project: "demo", branch: "alpha", createdAt: 0, status: "in-progress", isLive: true }],
      "run-alpha",
      { terminalColumns: 119 },
    );
    const stackedLayout = computeShellLayout(119, 72, 0);
    expect(stackedLayout.layoutMode).toBe("stacked");

    const stackedTree = createMonitorDisplay(state, stubText, stubBox);
    expect(paneContainerFlexDirection(stackedTree, stackedLayout.paneHeight)).toBe("column");

    const splitLayout = computeShellLayout(245, 72, 0);
    const splitTree = createMonitorDisplay(
      shellState(
        [{ runId: "run-alpha", project: "demo", branch: "alpha", createdAt: 0, status: "in-progress", isLive: true }],
        "run-alpha",
      ),
      stubText,
      stubBox,
    );
    expect(paneContainerFlexDirection(splitTree, splitLayout.paneHeight)).toBe("row");
  });

  test("left-pane row source reads from tree derivation with pipeline, stage, and run ids", () => {
    // Mutation checkpoint: using monitorLeftPaneTableRows for the tree segment in tui-ink-monitor.tsx must turn left-pane tree derivation RED.
    const pipelineId = "pipe-ink";
    const invocationId = "inv-ink";
    const stageId = monitorPipelineStageNodeId(pipelineId, "implement", "default");
    const snapshot = pipelineSnapshot({
      pipelineId,
      stages: [implementStage(invocationId)],
    });
    const run: DaemonListRunRow = {
      runId: "run-ink",
      project: "demo",
      branch: "main",
      createdAt: 0,
      status: "in-progress",
      isLive: true,
      workflow: {
        invocationId,
        steps: [{ stepId: "implement", role: "implement", status: "in_progress", attemptCount: 1 }],
      },
      stepId: "implement",
    };
    const state = shellState([run], "run-ink", {
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
      expandedPipelineNodeIds: [pipelineId, stageId],
    });

    const { treeRows } = monitorLeftPaneContentRows(state, TREE_NOW_MS);

    expect(treeRows.map((row) => ({ kind: row.kind, id: row.id }))).toEqual([
      { kind: "pipeline", id: pipelineId },
      { kind: "stage", id: stageId },
      { kind: "run", id: "run-ink" },
    ]);
  });

  test("an ad-hoc top-level row paints its entry run's branch as the label", () => {
    const branch = "adhoc-work";
    const run: DaemonListRunRow = {
      runId: "12345678-1234-1234-1234-123456789abc",
      project: "demo",
      branch,
      createdAt: 0,
      status: "in-progress",
      isLive: true,
      stepId: "implement",
      workflow: {
        invocationId: "inv-adhoc",
        steps: [{ stepId: "implement", role: "implement", status: "in_progress", attemptCount: 1 }],
      },
    };
    const tree = createMonitorDisplay(shellState([run], run.runId), stubText, stubBox, TREE_NOW_MS);

    expect(
      collectTextNodes(findRegion(tree, MonitorLeftPane), stubText).some((node) => node.text.trimEnd() === branch),
    ).toBe(true);
  });

  test("createMonitorDisplay retains unattributed orphans regardless of display clock", () => {
    const freshFinishedAt = TREE_NOW_MS - 60_000;
    const orphanRun: DaemonListRunRow = {
      runId: "run-fresh-orphan",
      project: "demo",
      branch: "orphan",
      createdAt: 0,
      status: "completed",
      isLive: false,
      finishedAtMs: freshFinishedAt,
      workflow: {
        invocationId: "inv-orphan",
        steps: [{ stepId: "x", role: "implement", status: "completed", attemptCount: 1 }],
      },
    };
    const state = shellState([orphanRun], "run-fresh-orphan");
    const farFutureMs = TREE_NOW_MS + TUI_TERMINAL_WINDOW_MS + 60_000;

    const inWindowTree = createMonitorDisplay(state, stubText, undefined, TREE_NOW_MS);
    const outOfWindowTree = createMonitorDisplay(state, stubText, undefined, farFutureMs);
    const displayTickTree = createMonitorDisplay(state, stubText, undefined, farFutureMs);

    expect(collectInkText(inWindowTree)).toContain("orphan");
    expect(collectInkText(findRegion(outOfWindowTree, MonitorLeftPane))).toContain("orphan");
    expect(collectInkText(findRegion(outOfWindowTree, MonitorLeftPane))).not.toContain("─ Unattributed");
    expect(collectInkText(findRegion(outOfWindowTree, MonitorRightPane))).toContain("runId: run-fresh-orphan");
    expect(collectInkText(displayTickTree)).toContain("orphan");
  });

  test("renders selected tree rows inverse without a caret", () => {
    const pipelineId = "pipe-row-fill";
    const invocationId = "inv-row-fill";
    const modelBranch = "alpha-branch";
    const monitorBranch = "beta-branch";
    const branchModelId = monitorPipelineBranchNodeId(pipelineId, modelBranch);
    const stageImplModelId = monitorPipelineStageNodeId(pipelineId, "implement", modelBranch);
    const stagePlanModelId = monitorPipelineStageNodeId(pipelineId, "plan", modelBranch);
    const baseStage = {
      workflowInvocationId: null,
      startedAt: null,
      endedAt: null,
      decidedAt: null,
      artifact: null,
      failureDetail: null,
    };
    const snapshot = pipelineSnapshot({
      pipelineId,
      name: "row-fill-pipeline",
      stages: [
        { ...baseStage, id: "s-intent", stageId: "intent", branchKey: "default", position: 0, status: "succeeded" },
        { ...baseStage, id: "s-plan-a", stageId: "plan", branchKey: modelBranch, position: 2, status: "succeeded" },
        { ...baseStage, id: "s-plan-b", stageId: "plan", branchKey: monitorBranch, position: 2, status: "succeeded" },
        {
          ...baseStage,
          id: "s-impl-a",
          stageId: "implement",
          branchKey: modelBranch,
          position: 4,
          status: "running",
          workflowInvocationId: invocationId,
        },
        {
          ...baseStage,
          id: "s-impl-b",
          stageId: "implement",
          branchKey: monitorBranch,
          position: 4,
          status: "running",
        },
      ],
    });
    const pipelineRun: DaemonListRunRow = {
      runId: "run-model-impl",
      project: "demo",
      branch: "model",
      createdAt: 0,
      status: "in-progress",
      isLive: true,
      workflow: {
        invocationId,
        steps: [{ stepId: "implement", role: "implement", status: "in_progress", attemptCount: 1 }],
      },
      stepId: "implement",
    };
    const adhocRun: DaemonListRunRow = {
      runId: "run-adhoc",
      project: "demo",
      branch: "adhoc-lane",
      createdAt: 0,
      status: "completed",
      isLive: false,
    };
    const state = shellState([pipelineRun, adhocRun], null, {
      pipelineSnapshotsBySocketPath: { "/tmp/row-fill.sock": { pipelines: [snapshot] } },
      expandedPipelineNodeIds: [pipelineId, branchModelId, stageImplModelId],
    });

    // Distinguishing, non-overlapping substrings per row: the branch's own "currentStage" cluster atom
    // can read "implement" too, so the stage case targets the (non-colliding) plan-alpha row instead.
    const scenarios: Array<[string, string]> = [
      [pipelineId, "row-fill-pipeline"],
      [branchModelId, modelBranch],
      [stagePlanModelId, "plan"],
      [pipelineRun.runId, "run-mode"],
      [adhocRun.runId, "adhoc-lane"],
    ];

    for (const [selectedNodeId, selectedText] of scenarios) {
      const tree = createMonitorDisplay({ ...state, selectedNodeId }, stubText, stubBox, TREE_NOW_MS);
      const leftText = collectTextNodes(findRegion(tree, MonitorLeftPane), stubText);
      // @mutate v2/src/tui/tui-ink-monitor.tsx "if (isSelected) props.inverse = true;" -> "if (!isSelected) props.inverse = true;"
      const selectedNodes = leftText.filter((node) => node.text.includes(selectedText));
      expect(selectedNodes.length).toBeGreaterThan(0);
      expect(selectedNodes.every((node) => node.inverse === true)).toBe(true);

      for (const [, otherText] of scenarios.filter(([, text]) => text !== selectedText)) {
        for (const node of leftText.filter((entry) => entry.text.includes(otherText))) {
          expect(node.inverse).not.toBe(true);
        }
      }

      expect(leftText.some((node) => node.text.trim() === ">")).toBe(false);
    }
  });
});

describe("openInkMonitor", () => {
  test("routes command-focused editor input before tree bindings", async () => {
    // @mutate v2/src/tui/tui-ink-monitor.tsx "if (commandFocused) {" -> "if (false) {"
    // @mutate v2/src/tui/tui-ink-monitor.tsx "if (editorSpecialKey) {" -> "if (false) {"
    // @mutate v2/src/tui/tui-ink-monitor.tsx "if (key.ctrl && input === \"c\") {" -> "if (false) {"
    // @mutate v2/src/tui/tui-ink-monitor.tsx "if (commandFocused) return;" -> "if (false) return;"
    // @mutate v2/src/tui/tui-ink-monitor.tsx "if (input === \":\" || input === \"/\") {" -> "if (false) {"
    const treeCalls: string[] = [];
    const treeControls = noopControls();
    treeControls.focusCommand = () => treeCalls.push("focus-command");
    treeControls.insertCommandText = (text) => treeCalls.push(`insert:${text}`);
    const treeInput = inputHarness();
    const treeSession = await openInkMonitor(
      shellState([], null, { commandBuffer: "kept", commandCursor: 2, focus: "tree" }),
      treeControls,
      await treeInput.injection(),
    );

    await treeInput.press(":");
    await treeInput.press("/");

    expect(treeCalls).toEqual(["focus-command", "focus-command"]);
    treeSession.close();

    const calls: string[] = [];
    const controls = noopControls();
    controls.focusTree = () => calls.push("focus-tree");
    controls.insertCommandText = (text) => calls.push(`insert:${text}`);
    controls.selectNextRun = () => calls.push("next");
    controls.selectPreviousRun = () => calls.push("previous");
    controls.toggleSelectedWorkflowExpansion = () => calls.push("expand");
    controls.killSelected = () => calls.push("kill");
    controls.quit = () => calls.push("quit");
    const state = shellState([], null, { commandBuffer: "AB", commandCursor: 1, focus: "command" });
    const before = structuredClone(state);
    const input = inputHarness();
    const session = await openInkMonitor(state, controls, await input.injection());

    for (const printable of ["j", "k", "e", "q", ":", "/", "[", "]"]) await input.press(printable);
    await input.press("", { downArrow: true });
    await input.press("", { upArrow: true });
    await input.press("", { escape: true });
    await input.press("c", { ctrl: true });

    expect(calls).toEqual([
      "insert:j",
      "insert:k",
      "insert:e",
      "insert:q",
      "insert::",
      "insert:/",
      "insert:[",
      "insert:]",
      "focus-tree",
      "quit",
    ]);
    expect(calls).not.toContain("next");
    expect(calls).not.toContain("previous");
    expect(calls).not.toContain("expand");
    expect(calls).not.toContain("kill");
    expect(state).toEqual(before);
    session.close();
  });

  test("submits only focused command input", async () => {
    // @mutate v2/src/tui/tui-ink-monitor.tsx "if (key.return && !key.shift) {" -> "if (false) {"
    // @mutate v2/src/tui/tui-ink-monitor.tsx "if (key.return && key.shift) return;" -> "if (false) return;"
    const submissions: string[] = [];
    const focusedControls = noopControls();
    focusedControls.submitCommand = (buffer) => submissions.push(buffer);
    focusedControls.insertCommandText = (text) => submissions.push(`insert:${text}`);
    const focusedState = shellState([], null, { commandBuffer: "run status", commandCursor: 3, focus: "command" });
    const focusedBefore = structuredClone(focusedState);
    const focusedInput = inputHarness();
    const focusedSession = await openInkMonitor(focusedState, focusedControls, await focusedInput.injection());

    await focusedInput.press("", { return: true });
    await focusedInput.press("x", { return: true, shift: true });

    expect(submissions).toEqual(["run status"]);
    expect(focusedState).toEqual(focusedBefore);
    focusedSession.close();

    const emptyInput = inputHarness();
    const emptySession = await openInkMonitor(
      shellState([], null, { commandBuffer: "", commandCursor: 0, focus: "command" }),
      focusedControls,
      await emptyInput.injection(),
    );
    await emptyInput.press("", { return: true });
    expect(submissions).toEqual(["run status", ""]);
    emptySession.close();

    const treeInput = inputHarness();
    const treeSession = await openInkMonitor(shellState([], null), focusedControls, await treeInput.injection());
    await treeInput.press("", { return: true });
    await treeInput.press("", { return: true, shift: true });
    expect(submissions).toEqual(["run status", ""]);
    treeSession.close();
  });

  test("classifies modified keys and paste before editor insertion", async () => {
    // @mutate v2/src/tui/tui-ink-monitor.tsx "if (key.ctrl || key.meta) return;" -> "if (false) return;"
    // @mutate v2/src/tui/tui-ink-monitor.tsx "if (inserted.length > 0) controls.insertCommandText(inserted);" -> "if (false) controls.insertCommandText(inserted);"
    // @mutate v2/src/tui/tui-ink-monitor.tsx "if (inserted !== \"\") controls.insertCommandText(inserted);" -> "if (false) controls.insertCommandText(inserted);"
    const calls: string[] = [];
    let cursor = 2;
    const controls = noopControls();
    controls.moveCommandCursorLeft = () => calls.push("left");
    controls.moveCommandCursorRight = () => calls.push("right");
    controls.deleteCommandBackward = () => calls.push("backspace");
    controls.deleteCommandForward = () => calls.push("delete");
    controls.focusTree = () => calls.push("escape");
    controls.insertCommandText = (text) => {
      calls.push(`insert:${text}`);
      cursor += Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)).length;
    };
    controls.selectNextRun = () => calls.push("next");
    controls.toggleSelectedWorkflowExpansion = () => calls.push("expand");
    controls.killSelected = () => calls.push("kill");
    controls.quit = () => calls.push("quit");
    const input = inputHarness();
    const session = await openInkMonitor(
      shellState([], null, { commandBuffer: "AB", commandCursor: cursor, focus: "command" }),
      controls,
      await input.injection(),
    );

    await input.press("x", { leftArrow: true });
    await input.press("x", { rightArrow: true });
    await input.press("x", { backspace: true });
    await input.press("x", { delete: true });
    await input.press("x", { escape: true });
    await input.press("x", { upArrow: true });
    await input.press("x", { downArrow: true });
    await input.press("Z");
    const beforeModified = [...calls];
    await input.press("j", { ctrl: true });
    await input.press("e", { meta: true });
    await input.press("x", { ctrl: true, leftArrow: true });
    await input.press("q", { meta: true, escape: true });
    expect(calls).toEqual(beforeModified);

    await input.paste("A👩‍💻\r\nB");
    await input.paste("\r\n");

    expect(calls).toEqual(["left", "right", "backspace", "delete", "escape", "insert:Z", "insert:A👩‍💻B"]);
    expect(cursor).toBe(6);
    expect(calls).not.toContain("next");
    expect(calls).not.toContain("expand");
    expect(calls).not.toContain("kill");
    expect(calls).not.toContain("quit");
    session.close();
  });

  test("keeps command state unchanged in tree focus", async () => {
    // @mutate v2/src/tui/tui-ink-monitor.tsx "if ((sessionState.current.focus ?? \"tree\") !== \"command\") return;" -> "if (false) return;"
    const editorCalls: string[] = [];
    const controls = noopControls();
    controls.focusCommand = () => editorCalls.push("focus-command");
    controls.insertCommandText = (text) => editorCalls.push(`insert:${text}`);
    controls.moveCommandCursorLeft = () => editorCalls.push("left");
    controls.moveCommandCursorRight = () => editorCalls.push("right");
    controls.deleteCommandBackward = () => editorCalls.push("backspace");
    controls.deleteCommandForward = () => editorCalls.push("delete");
    controls.quit = () => editorCalls.push("quit");
    const state = shellState([], null, { commandBuffer: "retained", commandCursor: 4, focus: "tree" });
    const before = structuredClone(state);
    const input = inputHarness();
    const session = await openInkMonitor(state, controls, await input.injection());

    await input.press("x");
    await input.press("q");
    await input.press("", { leftArrow: true });
    await input.press("", { rightArrow: true });
    await input.press("", { backspace: true });
    await input.press("", { delete: true });
    await input.paste("paste\r\ntext");

    expect(editorCalls).toEqual(["quit"]);
    expect(state).toEqual(before);
    session.close();
  });

  test("drives quit and kill through the injected input hook", async () => {
    const calls: string[] = [];
    const controls = noopControls();
    controls.quit = () => calls.push("quit");
    controls.killSelected = () => calls.push("kill");
    const input = inputHarness();
    const session = await openInkMonitor(shellState([], null), controls, await input.injection());

    await input.press("q");
    await input.press("c", { ctrl: true });
    await input.press("k");

    expect(calls).toEqual(["quit", "quit", "kill"]);
    expect(input.renderOptions()).toMatchObject({ exitOnCtrlC: false });
    session.close();
  });

  test("drives workflow expansion through the injected input hook", async () => {
    // Mutation checkpoint: change or remove the `input === "e"` branch in tui-ink-monitor.tsx.
    const calls: string[] = [];
    const controls = noopControls();
    controls.toggleSelectedWorkflowExpansion = () => calls.push("toggle");
    const input = inputHarness();
    const session = await openInkMonitor(shellState([], null), controls, await input.injection());

    await input.press("e");
    await input.press("e");

    expect(calls).toEqual(["toggle", "toggle"]);
    session.close();
  });

  test("e toggles the selected expandable row glyph", async () => {
    // @mutate v2/src/tui/tui-ink-monitor.tsx "controls.toggleSelectedWorkflowExpansion();" -> "return;"
    const pipelineId = "pipe-glyph-toggle";
    const invocationId = "inv-glyph-toggle";
    const snapshot = pipelineSnapshot({ pipelineId, stages: [implementStage(invocationId)] });
    const run: DaemonListRunRow = {
      runId: "run-glyph-toggle",
      project: "demo",
      branch: "main",
      createdAt: 0,
      status: "in-progress",
      isLive: true,
      workflow: {
        invocationId,
        steps: [{ stepId: "implement", role: "implement", status: "in_progress", attemptCount: 1 }],
      },
      stepId: "implement",
    };
    const initialState = shellState([run], pipelineId, {
      pipelineSnapshotsBySocketPath: { "/tmp/glyph-toggle.sock": { pipelines: [snapshot] } },
      expandedPipelineNodeIds: [],
    });

    const displayStates: TuiMonitorState[] = [initialState];
    const realCreateMonitorDisplay = inkMonitor.createMonitorDisplay;
    const spy = spyOn(inkMonitor, "createMonitorDisplay").mockImplementation((state, Text, Box, nowMs) => {
      displayStates.push({ ...state });
      return realCreateMonitorDisplay(state, Text, Box, nowMs);
    });

    let session: TuiMonitorSession | undefined;
    const controls = noopControls();
    controls.toggleSelectedWorkflowExpansion = () => {
      const current = displayStates.at(-1) ?? initialState;
      const selectedNodeId = current.selectedNodeId;
      if (selectedNodeId === null) return;
      const { pipelineNodes } = buildMonitorPipelineTreeJoin(
        mergePipelineSnapshots(current.pipelineSnapshotsBySocketPath),
        current.runs,
      );
      if (!isExpandablePipelineNodeId(pipelineNodes, selectedNodeId)) return;
      const expanded = new Set(current.expandedPipelineNodeIds ?? []);
      if (expanded.has(selectedNodeId)) expanded.delete(selectedNodeId);
      else expanded.add(selectedNodeId);
      session?.update({ ...current, expandedPipelineNodeIds: [...expanded] });
    };

    const input = inputHarness();
    session = await openInkMonitor(initialState, controls, await input.injection());

    const markerFor = (id: string): string | undefined => {
      const state = displayStates.at(-1) ?? initialState;
      const found = monitorLeftPaneContentRows(state, TREE_NOW_MS).treeRows.find((row) => row.id === id);
      return found !== undefined && "marker" in found ? found.marker : undefined;
    };

    expect(markerFor(pipelineId)).toBe("▶");

    await input.press("e");
    expect(markerFor(pipelineId)).toBe("▼");

    await input.press("e");
    expect(markerFor(pipelineId)).toBe("▶");

    // Leaf negative case: selecting the run row and pressing e changes neither expansion state nor its blank marker.
    session.update({ ...(displayStates.at(-1) ?? initialState), selectedNodeId: run.runId });
    const beforeLeaf = displayStates.at(-1) ?? initialState;
    expect(monitorLeftPaneContentRows(beforeLeaf, TREE_NOW_MS).treeRows.find((row) => row.id === run.runId)?.kind).toBe(
      "run",
    );
    const expandedBeforeLeaf = beforeLeaf.expandedPipelineNodeIds;

    await input.press("e");
    const afterLeaf = displayStates.at(-1) ?? initialState;
    expect(afterLeaf.expandedPipelineNodeIds).toEqual(expandedBeforeLeaf);
    expect(markerFor(run.runId)).toBeUndefined();

    spy.mockRestore();
    session.close();
  });

  test("drives row navigation through the injected input hook", async () => {
    const calls: string[] = [];
    const controls = noopControls();
    controls.selectNextRun = () => calls.push("next");
    controls.selectPreviousRun = () => calls.push("previous");
    const input = inputHarness();
    const session = await openInkMonitor(shellState([], null), controls, await input.injection());

    await input.press("j");
    await input.press("", { downArrow: true });
    await input.press("", { upArrow: true });

    expect(calls).toEqual(["next", "next", "previous"]);
    session.close();
  });

  test("[/] nudge divider offset through session state at 245×72", async () => {
    // Mutation checkpoint: skip updating session `dividerOffset` on `[`/`]` in tui-ink-monitor.tsx.
    const displayStates: TuiMonitorState[] = [];
    const realCreateMonitorDisplay = inkMonitor.createMonitorDisplay;
    const spy = spyOn(inkMonitor, "createMonitorDisplay").mockImplementation((state, Text, Box) => {
      displayStates.push({ ...state });
      return realCreateMonitorDisplay(state, Text, Box);
    });

    const state = shellState(
      [{ runId: "run-live", project: "demo", branch: "main", createdAt: 0, status: "in-progress", isLive: true }],
      "run-live",
    );
    const input = inputHarness();
    const session = await openInkMonitor(state, noopControls(), await input.injection());

    const baseWidth = computeShellLayout(245, 72, 0).leftWidth;
    expect(displayStates.at(-1)?.dividerOffset ?? 0).toBe(0);

    await input.press("]");
    const widerDisplayState = displayStates.at(-1);
    expect(widerDisplayState?.dividerOffset).toBe(2);
    expect(widerDisplayState).toBeDefined();
    if (!widerDisplayState) throw new Error("expected wider display state");
    const widerTree = realCreateMonitorDisplay(widerDisplayState, stubText, stubBox);
    expect(regionBoxWidth(findRegion(widerTree, MonitorLeftPane))).toBe(baseWidth + 2);

    for (let step = 0; step < 20; step += 1) {
      await input.press("[");
    }
    let expectedOffset = 0;
    for (let step = 0; step < 20; step += 1) {
      expectedOffset = nudgeDividerOffset(245, expectedOffset, "[");
    }
    expect(displayStates.at(-1)?.dividerOffset).toBe(expectedOffset);
    expect(computeShellLayout(245, 72, expectedOffset).leftWidth).toBe(72);
    expect(nudgeDividerOffset(245, expectedOffset, "[")).toBe(expectedOffset);

    spy.mockRestore();
    session.close();
  });

  // One representative row per tone; status→tone completeness is guarded in tui-monitor-lines tests.
  test("colors status and liveness cells on run-table rows", async () => {
    const state = shellState(
      [
        { runId: "run-live", project: "demo", branch: "a", createdAt: 0, status: "in-progress", isLive: true },
        { runId: "run-done", project: "demo", branch: "b", createdAt: 0, status: "completed", isLive: false },
        { runId: "run-fail", project: "demo", branch: "c", createdAt: 0, status: "failed", isLive: false },
      ],
      "run-live",
    );
    const ink = createInkCapture(state);
    const { Text, Box } = await loadInkUi(ink.inkRender);
    ink.setTextType(Text);
    ink.setBoxType(Box);

    const session = await openInkMonitor(state, noopControls(), ink.inkRender);
    const nodes = collectTextNodes(ink.lastRender(), Text);

    expect(textNode(nodes, "in-progress").color).toBe("cyan");
    expect(textNode(nodes, "live").color).toBe("cyan");
    expect(textNode(nodes, "completed").color).toBe("green");
    const idleNodes = nodes.filter((node) => node.text.trimEnd() === MONITOR_TREE_NOT_LIVE_LABEL);
    expect(idleNodes.length).toBeGreaterThan(0);
    expect(idleNodes.every((node) => node.color === undefined)).toBe(true);
    expect(textNode(nodes, "failed").color).toBe("red");
    expect(textNode(nodes, "a").color).toBeUndefined();

    session.close();
  });

  test("colors queue status and leaves admission descriptor uncolored", async () => {
    const state = shellState(
      [
        { runId: "run-active", project: "demo", branch: "main", createdAt: 0, status: "in-progress", isLive: true },
        { runId: "run-queued", project: "demo", branch: "q", createdAt: 0, status: "queued", isLive: false },
      ],
      "run-active",
    );
    const ink = createInkCapture(state);
    const { Text, Box } = await loadInkUi(ink.inkRender);
    ink.setTextType(Text);
    ink.setBoxType(Box);

    const session = await openInkMonitor(state, noopControls(), ink.inkRender);
    const nodes = collectTextNodes(ink.lastRender(), Text);

    const queuedStatusNodes = nodes.filter((node) => node.text === "queued");
    expect(queuedStatusNodes.some((node) => node.color === "cyan")).toBe(true);
    expect(textNode(nodes, "waiting: memory headroom").color).toBeUndefined();

    session.close();
  });
});
