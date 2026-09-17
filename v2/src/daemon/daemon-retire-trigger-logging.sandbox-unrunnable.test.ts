import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type IpcServer, type RpcHandler, startIpcServer } from "../ipc/server.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { formatHandoffSettlementLogLine, startDaemonRuntime } from "./daemon.ts";

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
  dbPath = join(tmpdir(), `jarvis-retire-trigger-live-${unique}.sqlite`);
  socketPath = join(tmpdir(), `jarvis-retire-trigger-live-${unique}.sock`);
  store = openStateStore(dbPath);
});

afterEach(() => {
  store.close();
  rmSync(dbPath, { force: true });
});

/** Boots the full RPC handler map with a faked IPC server, so `changeover` can be called directly
 * without a real socket or real ambient `~/.jarvis` state — the public `socketPath` itself stays
 * free for this file's real successor listener. */
async function startFakeDaemon(
  extraDeps: Parameters<typeof startDaemonRuntime>[3] = {},
): Promise<{ handlers: Record<string, RpcHandler>; close: () => Promise<void> }> {
  let handlers: Record<string, RpcHandler> = {};
  const unique = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const runtime = await startDaemonRuntime(socketPath, store, undefined, {
    logsPath: join(tmpdir(), `jarvis-retire-trigger-live-logs-${unique}.jsonl`),
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

test("fallback timer logs handoff_fallback naming commit when a successor answers live", async () => {
  const unique = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const privateSocketPath = join(tmpdir(), `jarvis-retire-trigger-live-private-${unique}.sock`);
  const { handlers, close } = await startFakeDaemon({ privateSocketPath, handoffFallbackMs: 150 });
  const capture = captureConsoleError();
  let successor: IpcServer | undefined;
  try {
    await beginChangeover(handlers);
    successor = await startIpcServer(socketPath, { health: () => ({ kind: "response", result: {} }) });
    expect(await waitFor(() => capture.lines.some((line) => line.includes("handoff_fallback")), 2_000)).toBe(true);
    expect(capture.lines).toContain(formatHandoffSettlementLogLine("handoff_fallback", "commit"));
  } finally {
    capture.restore();
    await successor?.close();
    await close();
  }
});
