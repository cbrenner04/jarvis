import { describe, expect, test } from "bun:test";
import { createElement, Fragment } from "react";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { InkRender } from "./tui-ink-feedback.tsx";
import { createMonitorDisplay, openInkMonitor } from "./tui-ink-monitor.tsx";
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

function createInkCapture(state: TuiMonitorState) {
  const renders: unknown[] = [];
  let TextType: unknown;
  const inkRender = ((element: unknown) => {
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

describe("openInkMonitor", () => {
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

    const session = await openInkMonitor(state, noopControls(), ((element: unknown) => ({
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
