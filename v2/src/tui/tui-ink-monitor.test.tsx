import { describe, expect, test } from "bun:test";
import { createElement, Fragment, type ReactElement } from "react";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { InkRender } from "./tui-ink-feedback.tsx";
import { createMonitorDisplay, openInkMonitor } from "./tui-ink-monitor.tsx";
import type { InjectedInkUi, InkUseInput } from "./tui-ink-runtime.ts";
import { loadInkUi } from "./tui-ink-runtime.ts";
import { joinMonitorRow, monitorSegmentRows } from "./tui-monitor-lines.ts";
import type { TuiMonitorControls, TuiMonitorState } from "./tui-monitor-types.ts";

type TextCapture = { text: string; color?: string };

function collectInkText(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectInkText).join("");
  if (typeof node !== "object") return "";
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  if (typeof element.type === "function") {
    return collectInkText(element.type(element.props ?? {}));
  }
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
  if (typeof element.type === "function") {
    return collectTextNodes(element.type(element.props ?? {}), TextType);
  }
  if ("props" in element) {
    return collectTextNodes(element.props?.children, TextType);
  }
  return [];
}

function collectRowTexts(node: unknown): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap((child) => collectRowTexts(child));
  if (typeof node !== "object") return [];
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  if (element.type === Fragment && Array.isArray(element.props?.children)) {
    const children = element.props.children as unknown[];
    const rowLike = children.every(
      (child) => typeof child === "object" && child !== null && (child as { type?: unknown }).type === Fragment,
    );
    if (rowLike) {
      return children.map((child) => collectInkText((child as { props?: { children?: unknown } }).props?.children));
    }
  }
  if (typeof element.type === "function") {
    return collectRowTexts(element.type(element.props ?? {}));
  }
  if ("props" in element) {
    return collectRowTexts(element.props?.children);
  }
  return [];
}

// Ignores the real element openInkMonitor passes and rebuilds the tree via createMonitorDisplay
// instead: walking the actual element would invoke MonitorSessionRoot's useState/useInput outside
// a reconciler and throw. This proves createMonitorDisplay colors correctly and that renderFn was
// called, not that openInkMonitor renders this exact tree.
function createInkCapture(state: TuiMonitorState) {
  const renders: unknown[] = [];
  let TextType: unknown;
  const inkRender = ((_element: unknown) => {
    if (TextType === undefined) throw new Error("expected Text before render");
    renders.push(createMonitorDisplay(state, { kind: "idle" }, TextType as Parameters<typeof createMonitorDisplay>[2]));
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
    pauseSelected() {},
    resumeSelected() {},
    killSelected() {},
    approveSelected() {},
    reviseSelected() {},
    quit() {},
  };
}

function monitorState(runs: readonly DaemonListRunRow[], selectedRunId: string | null): TuiMonitorState {
  return {
    runs,
    selectedRunId,
    waitState: { kind: "none" },
    steeringFeedback: null,
  };
}

function textNode(nodes: TextCapture[], text: string): TextCapture {
  const match = nodes.find((node) => node.text === text);
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

describe("openInkMonitor", () => {
  test("drives quit, approve, and kill through the injected input hook", async () => {
    const calls: string[] = [];
    const controls = noopControls();
    controls.quit = () => calls.push("quit");
    controls.approveSelected = () => calls.push("approve");
    controls.killSelected = () => calls.push("kill");
    const input = inputHarness();
    const session = await openInkMonitor(monitorState([], null), controls, await input.injection());

    await input.press("q");
    await input.press("c", { ctrl: true });
    await input.press("a");
    await input.press("k");

    expect(calls).toEqual(["quit", "quit", "approve", "kill"]);
    session.close();
  });

  test("drives row navigation through the injected input hook", async () => {
    const calls: string[] = [];
    const controls = noopControls();
    controls.selectNextRun = () => calls.push("next");
    controls.selectPreviousRun = () => calls.push("previous");
    const input = inputHarness();
    const session = await openInkMonitor(monitorState([], null), controls, await input.injection());

    await input.press("j");
    await input.press("", { downArrow: true });
    await input.press("", { upArrow: true });

    expect(calls).toEqual(["next", "next", "previous"]);
    session.close();
  });

  test("composes, submits, and cancels revise prompts through the injected input hook", async () => {
    const prompts: Array<string | undefined> = [];
    const controls = noopControls();
    controls.reviseSelected = (prompt) => prompts.push(prompt);
    const input = inputHarness();
    const session = await openInkMonitor(monitorState([], null), controls, await input.injection());

    await input.press("v");
    await input.press("a");
    await input.press("b");
    await input.press("", { backspace: true });
    await input.press("c");
    await input.press("", { delete: true });
    await input.press("", { return: true });
    await input.press("v");
    await input.press("", { return: true });
    await input.press("v");
    await input.press("x");
    await input.press("", { escape: true });

    expect(prompts).toEqual(["a", undefined]);
    session.close();
  });

  test("treats control bindings as prompt text while composing", async () => {
    const calls: string[] = [];
    const controls = noopControls();
    controls.quit = () => calls.push("quit");
    controls.approveSelected = () => calls.push("approve");
    controls.killSelected = () => calls.push("kill");
    controls.selectNextRun = () => calls.push("next");
    controls.selectPreviousRun = () => calls.push("previous");
    controls.reviseSelected = (prompt) => calls.push(`revise:${prompt}`);
    const input = inputHarness();
    const session = await openInkMonitor(monitorState([], null), controls, await input.injection());

    await input.press("v");
    await input.press("q");
    await input.press("a");
    await input.press("k");
    await input.press("j");
    await input.press("", { downArrow: true });
    await input.press("", { upArrow: true });
    await input.press("", { return: true });

    expect(calls).toEqual(["revise:qakj"]);
    session.close();
  });

  test("colors status and liveness cells on run-table rows", async () => {
    const state = monitorState(
      [
        { runId: "run-live", project: "demo", branch: "a", status: "in-progress", isLive: true },
        { runId: "run-done", project: "demo", branch: "b", status: "completed", isLive: false },
        { runId: "run-fail", project: "demo", branch: "c", status: "failed", isLive: false },
        { runId: "run-blocked", project: "demo", branch: "d", status: "blocked", isLive: false },
        { runId: "run-budget", project: "demo", branch: "e", status: "budget-soft-stopped", isLive: false },
        { runId: "run-paused", project: "demo", branch: "f", status: "paused", isLive: false },
        { runId: "run-human", project: "demo", branch: "g", status: "awaiting-human", isLive: false },
        { runId: "run-revising", project: "demo", branch: "h", status: "revising", isLive: false },
        { runId: "run-killed", project: "demo", branch: "i", status: "killed", isLive: false },
      ],
      "run-live",
    );
    const ink = createInkCapture(state);
    const { Text } = await loadInkUi(ink.inkRender);
    ink.setTextType(Text);

    const session = await openInkMonitor(state, noopControls(), ink.inkRender);
    const nodes = collectTextNodes(ink.lastRender(), Text);

    expect(textNode(nodes, "in-progress").color).toBe("cyan");
    expect(textNode(nodes, "live").color).toBe("cyan");
    expect(textNode(nodes, "completed").color).toBe("green");
    expect(textNode(nodes, "not-live").color).toBeUndefined();
    expect(textNode(nodes, "failed").color).toBe("red");
    expect(textNode(nodes, "blocked").color).toBe("red");
    expect(textNode(nodes, "budget-soft-stopped").color).toBe("red");
    expect(textNode(nodes, "paused").color).toBe("cyan");
    expect(textNode(nodes, "awaiting-human").color).toBe("cyan");
    expect(textNode(nodes, "revising").color).toBe("cyan");
    expect(textNode(nodes, "killed").color).toBe("red");
    expect(textNode(nodes, "run-live").color).toBeUndefined();

    session.close();
  });

  test("colors queue status and leaves admission descriptor uncolored", async () => {
    const state = monitorState(
      [
        { runId: "run-active", project: "demo", branch: "main", status: "in-progress", isLive: true },
        { runId: "run-queued", project: "demo", branch: "q", status: "queued", isLive: false },
      ],
      "run-active",
    );
    const ink = createInkCapture(state);
    const { Text } = await loadInkUi(ink.inkRender);
    ink.setTextType(Text);

    const session = await openInkMonitor(state, noopControls(), ink.inkRender);
    const nodes = collectTextNodes(ink.lastRender(), Text);

    const queuedStatusNodes = nodes.filter((node) => node.text === "queued");
    expect(queuedStatusNodes.some((node) => node.color === "cyan")).toBe(true);
    expect(textNode(nodes, "waiting: memory headroom").color).toBeUndefined();

    session.close();
  });

  // loadInkUi(inkRender) never supplies Box, so this only exercises renderSegmentRow's Fragment
  // fallback, not the real-Ink Box branch used by production `jarvis tui`. Pre-existing gap in
  // this test seam, not newly introduced here.
  test("concatenated rendered row cells match monitorTextLines entries", async () => {
    const state = monitorState(
      [
        { runId: "run-alpha", project: "demo", branch: "alpha", status: "in-progress", isLive: true },
        { runId: "run-beta", project: "demo", branch: "beta", status: "completed", isLive: false },
      ],
      "run-alpha",
    );
    const ink = createInkCapture(state);
    const { Text } = await loadInkUi(ink.inkRender);
    ink.setTextType(Text);

    const session = await openInkMonitor(state, noopControls(), ink.inkRender);
    const renderedRows = collectRowTexts(ink.lastRender());
    const expectedRows = monitorSegmentRows(state).map(joinMonitorRow);
    expect(renderedRows).toEqual(expectedRows);

    session.close();
  });

  test("composing revise prompt renders as an uncolored segment row", async () => {
    const state = monitorState(
      [{ runId: "run-human", project: "demo", branch: "main", status: "awaiting-human", isLive: false }],
      "run-human",
    );
    const { Text } = await loadInkUi();
    const tree = createMonitorDisplay(state, { kind: "composing", buffer: "" }, Text);
    const nodes = collectTextNodes(tree, Text);
    const reviseLine = textNode(nodes, "Revise prompt: ");
    expect(reviseLine.color).toBeUndefined();

    const session = await openInkMonitor(state, noopControls(), ((_element: unknown) => ({
      rerender() {},
      unmount() {},
      waitUntilExit: async () => {},
      cleanup() {},
      clear() {},
      waitUntilRenderFlush: async () => {},
    })) as InkRender);
    session.close();
  });
});
