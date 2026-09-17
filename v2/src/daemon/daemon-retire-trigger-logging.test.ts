import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IpcServer, RpcHandler } from "../ipc/server.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import {
  createSignalHandler,
  formatDrainExitLogLine,
  formatHandoffSettlementLogLine,
  formatRetireTriggerLogLine,
  nextFirstRetireTrigger,
  startDaemonRuntime,
  startDrainExitLoop,
} from "./daemon.ts";

function captureConsoleError(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "));
  };
  return {
    lines,
    restore: () => {
      console.error = original;
    },
  };
}

/** Bounded poll, not a bare timer wait: terminates on the condition or the deadline, whichever comes first. */
async function waitFor(predicate: () => boolean, boundMs: number, stepMs = 5): Promise<boolean> {
  const deadline = Date.now() + boundMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return predicate();
}

let store: StateStore;
let dbPath: string;
let socketPath: string;

beforeEach(() => {
  const unique = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  dbPath = join(tmpdir(), `jarvis-retire-trigger-${unique}.sqlite`);
  socketPath = join(tmpdir(), `jarvis-retire-trigger-${unique}.sock`);
  store = openStateStore(dbPath);
});

afterEach(() => {
  store.close();
  rmSync(dbPath, { force: true });
});

/** Boots the full RPC handler map with a faked IPC server, so `supersede`/`shutdown`/`changeover`
 * can be called directly without a real socket or real ambient `~/.jarvis` state. */
async function startFakeDaemon(
  extraDeps: Parameters<typeof startDaemonRuntime>[3] = {},
): Promise<{ handlers: Record<string, RpcHandler>; close: () => Promise<void> }> {
  let handlers: Record<string, RpcHandler> = {};
  const unique = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const runtime = await startDaemonRuntime(socketPath, store, undefined, {
    logsPath: join(tmpdir(), `jarvis-retire-trigger-logs-${unique}.jsonl`),
    openLogSink: () => ({ append: () => undefined, close: () => undefined }),
    enumerateOtherDaemonSockets: () => [],
    readNotificationSinkCommand: () => undefined,
    startIpcServer: async (boundSocketPath, h) => {
      handlers = h ?? {};
      return { socketPath: boundSocketPath, close: async () => undefined } as IpcServer;
    },
    ...extraDeps,
  });
  return { handlers, close: runtime.close };
}

test("supersede logs the retire-trigger line naming supersede", async () => {
  const { handlers, close } = await startFakeDaemon();
  const capture = captureConsoleError();
  try {
    await handlers.supersede?.({ kind: "request", id: "s1", method: "supersede" }, new AbortController().signal);
    expect(capture.lines).toContain(formatRetireTriggerLogLine("supersede"));
  } finally {
    capture.restore();
    await close();
  }
});

test("shutdown logs the retire-trigger line naming shutdown", async () => {
  const { handlers, close } = await startFakeDaemon();
  const capture = captureConsoleError();
  try {
    await handlers.shutdown?.({ kind: "request", id: "sh1", method: "shutdown" }, new AbortController().signal);
    expect(capture.lines).toContain(formatRetireTriggerLogLine("shutdown"));
  } finally {
    capture.restore();
    await close();
  }
});

test("changeover logs the retire-trigger line naming changeover once the handoff actually begins", async () => {
  const unique = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const privateSocketPath = join(tmpdir(), `jarvis-retire-trigger-private-${unique}.sock`);
  const { handlers, close } = await startFakeDaemon({ privateSocketPath });
  const capture = captureConsoleError();
  try {
    await handlers.changeover?.({ kind: "request", id: "c1", method: "changeover" }, new AbortController().signal);
    expect(capture.lines).toContain(formatRetireTriggerLogLine("changeover"));
  } finally {
    capture.restore();
    await close();
  }
});

/** Drives `changeover` to create the pending transaction and returns its `handoffId`. */
async function beginChangeover(handlers: Record<string, RpcHandler>): Promise<string> {
  const response = await handlers.changeover?.(
    { kind: "request", id: "c", method: "changeover" },
    new AbortController().signal,
  );
  if (response?.kind !== "response") throw new Error("changeover did not return a response");
  const handoffId = (response.result as { handoffId?: unknown }).handoffId;
  if (typeof handoffId !== "string") throw new Error("changeover response missing handoffId");
  return handoffId;
}

test("handoff_commit logs the retire-trigger line naming handoff_commit before committing", async () => {
  const unique = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const privateSocketPath = join(tmpdir(), `jarvis-retire-trigger-private-${unique}.sock`);
  const { handlers, close } = await startFakeDaemon({ privateSocketPath });
  const capture = captureConsoleError();
  try {
    const handoffId = await beginChangeover(handlers);
    const response = await handlers.handoff_commit?.(
      { kind: "request", id: "hc1", method: "handoff_commit", params: { handoffId } },
      new AbortController().signal,
    );
    expect(response?.kind).toBe("response");
    expect(capture.lines).toContain(formatHandoffSettlementLogLine("handoff_commit"));
  } finally {
    capture.restore();
    await close();
  }
});

test("handoff_rollback logs the retire-trigger line naming handoff_rollback before rolling back", async () => {
  const unique = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const privateSocketPath = join(tmpdir(), `jarvis-retire-trigger-private-${unique}.sock`);
  const { handlers, close } = await startFakeDaemon({ privateSocketPath });
  const capture = captureConsoleError();
  try {
    const handoffId = await beginChangeover(handlers);
    const response = await handlers.handoff_rollback?.(
      { kind: "request", id: "hr1", method: "handoff_rollback", params: { handoffId } },
      new AbortController().signal,
    );
    expect(response?.kind).toBe("response");
    expect(capture.lines).toContain(formatHandoffSettlementLogLine("handoff_rollback"));
  } finally {
    capture.restore();
    await close();
  }
});

test("fallback timer logs handoff_fallback naming rollback when no successor answers", async () => {
  const unique = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const privateSocketPath = join(tmpdir(), `jarvis-retire-trigger-private-${unique}.sock`);
  const { handlers, close } = await startFakeDaemon({ privateSocketPath, handoffFallbackMs: 20 });
  const capture = captureConsoleError();
  try {
    await beginChangeover(handlers);
    expect(await waitFor(() => capture.lines.some((line) => line.includes("handoff_fallback")), 2_000)).toBe(true);
    expect(capture.lines).toContain(formatHandoffSettlementLogLine("handoff_fallback", "rollback"));
  } finally {
    capture.restore();
    await close();
  }
});

test("createSignalHandler on SIGINT requests shutdown and records sigint", () => {
  let shutdownRequested = false;
  const recorded: string[] = [];
  const handler = createSignalHandler({
    setShutdownRequested: () => {
      shutdownRequested = true;
    },
    recordRetireTrigger: (trigger) => recorded.push(trigger),
  });
  handler("SIGINT");
  expect(shutdownRequested).toBe(true);
  expect(recorded).toEqual(["sigint"]);
});

test("createSignalHandler on SIGTERM requests shutdown and records sigterm", () => {
  let shutdownRequested = false;
  const recorded: string[] = [];
  const handler = createSignalHandler({
    setShutdownRequested: () => {
      shutdownRequested = true;
    },
    recordRetireTrigger: (trigger) => recorded.push(trigger),
  });
  handler("SIGTERM");
  expect(shutdownRequested).toBe(true);
  expect(recorded).toEqual(["sigterm"]);
});

test("nextFirstRetireTrigger records the first trigger and ignores later ones", () => {
  // Inverting `current ?? incoming` to `incoming ?? current` would let a later trigger displace
  // the first one; assert both the "nothing recorded yet" and "already recorded" directions.
  expect(nextFirstRetireTrigger(null, "supersede")).toBe("supersede");
  expect(nextFirstRetireTrigger("supersede", "shutdown")).toBe("supersede");
});

test("startDrainExitLoop logs the drain-exit line naming the first retire trigger at actual exit", async () => {
  const exitCodes: number[] = [];
  const capture = captureConsoleError();
  const loop = startDrainExitLoop({
    shouldShutdown: () => true,
    close: async () => undefined,
    processExit: (code) => {
      exitCodes.push(code);
    },
    intervalMs: 5,
    firstRetireTrigger: () => "supersede",
  });
  try {
    expect(await waitFor(() => exitCodes.length > 0, 2_000)).toBe(true);
    expect(capture.lines).toContain(formatDrainExitLogLine("supersede"));
  } finally {
    capture.restore();
    loop.stop();
  }
});

test("startDrainExitLoop logs a null trigger when none was recorded this generation", async () => {
  const exitCodes: number[] = [];
  const capture = captureConsoleError();
  const loop = startDrainExitLoop({
    shouldShutdown: () => true,
    close: async () => undefined,
    processExit: (code) => {
      exitCodes.push(code);
    },
    intervalMs: 5,
  });
  try {
    expect(await waitFor(() => exitCodes.length > 0, 2_000)).toBe(true);
    expect(capture.lines).toContain(formatDrainExitLogLine(null));
  } finally {
    capture.restore();
    loop.stop();
  }
});
