import { describe, expect, spyOn, test } from "bun:test";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { InkRender } from "./tui-ink-feedback.tsx";
import * as inkMonitor from "./tui-ink-monitor.tsx";
import {
  createMonitorDisplay,
  MonitorDock,
  MonitorLeftPane,
  MonitorRightPane,
  openInkMonitor,
} from "./tui-ink-monitor.tsx";
import type { InjectedInkUi, InkUseInput } from "./tui-ink-runtime.ts";
import { loadInkUi } from "./tui-ink-runtime.ts";
import { computeShellLayout, nudgeDividerOffset } from "./tui-shell-layout.ts";
import type { TuiMonitorControls, TuiMonitorState } from "./tui-monitor-types.ts";
import { tuiRefreshIntervalLabel } from "./tui-entry.tsx";

type TextCapture = { text: string; color?: string };

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
    const capture: TextCapture = { text };
    if (typeof color === "string") capture.color = color;
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

function stubText(props: { children?: string; color?: string }): ReactElement {
  return createElement("monitor-text", props.color === undefined ? null : { color: props.color }, props.children);
}

function shellState(
  runs: readonly DaemonListRunRow[],
  selectedRunId: string | null,
  overrides: Partial<TuiMonitorState> = {},
): TuiMonitorState {
  return {
    runs,
    selectedRunId,
    waitState: { kind: "none" },
    steeringFeedback: null,
    expandedWorkflowInvocationIds: [],
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
    selectRun() {},
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
  let instance: Awaited<ReturnType<InkRender>> | undefined;
  const useInput: InkUseInput = (nextHandler) => {
    inputHandler = nextHandler;
  };

  return {
    async injection(): Promise<InjectedInkUi> {
      const ink = await import("ink");
      return {
        renderFn: ((element: ReactElement) => {
          instance = ink.render(element, { exitOnCtrlC: false });
          return instance;
        }) as InkRender,
        Text: ({ children, color }) => createElement(ink.Text, color === undefined ? null : { color }, children),
        Box: ({ children, ...props }) => createElement(ink.Box, props, children),
        useInput,
      };
    },
    async press(input: string, key: Parameters<Parameters<InkUseInput>[0]>[1] = {}) {
      if (inputHandler === undefined) throw new Error("expected input handler");
      inputHandler(input, key);
      if (instance === undefined) throw new Error("expected ink instance");
      await instance.waitUntilRenderFlush();
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
        { runId: "run-alpha", project: "demo", branch: "alpha", status: "in-progress", isLive: true },
        { runId: "run-beta", project: "demo", branch: "beta", status: "completed", isLive: false },
      ],
      "run-alpha",
      {
        waitState: {
          kind: "ready",
          runId: "run-alpha",
          result: { runStatus: "completed", loopOutcomeKind: "complete" },
        },
      },
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

    expect(leftText).toContain("run-alpha");
    expect(leftText).not.toContain("Outcome");
    expect(leftText).not.toContain("runStatus:");
    expect(rightText).toContain("Outcome");
    expect(rightText).toContain("runStatus: completed");
    expect(rightText).not.toContain("run-alpha");
    expect(rightText).not.toContain("run-beta");
    expect(dockText).toContain("1 active · refresh 1s");
    expect(leftText).not.toContain("1 active · refresh 1s");
    expect(rightText).not.toContain("1 active · refresh 1s");
    expect(regionBoxWidth(left)).toBe(computeShellLayout(245, 72, 0).leftWidth);
  });

  test("stacked shell vertically stacks left and right panes below 120 columns", () => {
    // Mutation checkpoint: skip the `layoutMode === "stacked"` branch in tui-ink-monitor.tsx.
    const state = shellState(
      [{ runId: "run-alpha", project: "demo", branch: "alpha", status: "in-progress", isLive: true }],
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
        [{ runId: "run-alpha", project: "demo", branch: "alpha", status: "in-progress", isLive: true }],
        "run-alpha",
      ),
      stubText,
      stubBox,
    );
    expect(paneContainerFlexDirection(splitTree, splitLayout.paneHeight)).toBe("row");
  });
});

describe("openInkMonitor", () => {
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
      [{ runId: "run-live", project: "demo", branch: "main", status: "in-progress", isLive: true }],
      "run-live",
    );
    const input = inputHarness();
    const session = await openInkMonitor(state, noopControls(), await input.injection());

    const baseWidth = computeShellLayout(245, 72, 0).leftWidth;
    expect(displayStates.at(-1)?.dividerOffset ?? 0).toBe(0);

    await input.press("]");
    expect(displayStates.at(-1)?.dividerOffset).toBe(2);
    const widerTree = realCreateMonitorDisplay(displayStates.at(-1)!, stubText, stubBox);
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
        { runId: "run-live", project: "demo", branch: "a", status: "in-progress", isLive: true },
        { runId: "run-done", project: "demo", branch: "b", status: "completed", isLive: false },
        { runId: "run-fail", project: "demo", branch: "c", status: "failed", isLive: false },
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
    expect(nodes.filter((node) => node.text.startsWith("not-")).every((node) => node.color === undefined)).toBe(true);
    expect(textNode(nodes, "failed").color).toBe("red");
    expect(textNode(nodes, "run-live").color).toBeUndefined();

    session.close();
  });

  test("colors queue status and leaves admission descriptor uncolored", async () => {
    const state = shellState(
      [
        { runId: "run-active", project: "demo", branch: "main", status: "in-progress", isLive: true },
        { runId: "run-queued", project: "demo", branch: "q", status: "queued", isLive: false },
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
