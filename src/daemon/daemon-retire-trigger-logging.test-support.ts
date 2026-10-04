import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IpcServer, RpcHandler } from "../ipc/server.ts";
import type { StateStore } from "../persistence/state-store.ts";
import { startDaemonRuntime } from "./daemon.ts";

export function captureConsoleError(): { lines: string[]; restore: () => void } {
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
export async function waitFor(predicate: () => boolean, boundMs: number, stepMs = 5): Promise<boolean> {
  const deadline = Date.now() + boundMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return predicate();
}

/** Random suffix for tmp file/socket names, unique enough across concurrent test runs. */
export function uniqueId(): string {
  return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Boots the full RPC handler map with a faked IPC server, so `supersede`/`shutdown`/`changeover`
 * can be called directly without a real socket or real ambient `~/.jarvis` state. */
export async function startFakeDaemon(
  store: StateStore,
  socketPath: string,
  extraDeps: Parameters<typeof startDaemonRuntime>[3] = {},
): Promise<{ handlers: Record<string, RpcHandler>; close: () => Promise<void> }> {
  let handlers: Record<string, RpcHandler> = {};
  // Standing in for the real `process.exit`, which would kill the test runner: several tests here
  // leave the daemon retiring and idle with no handoff pending, and the real drain-exit loop can
  // fire before the test's own `close()` does. The cast matches the seam's `never` return type
  // without actually terminating anything.
  const processExit = ((_code: number) => undefined) as unknown as (code: number) => never;
  const runtime = await startDaemonRuntime(socketPath, store, undefined, {
    logsPath: join(tmpdir(), `jarvis-retire-trigger-logs-${uniqueId()}.jsonl`),
    openLogSink: () => ({ append: () => undefined, close: () => undefined }),
    enumerateOtherDaemonSockets: () => [],
    readNotificationSinkCommand: () => undefined,
    startIpcServer: async (boundSocketPath, h) => {
      handlers = h ?? {};
      return { socketPath: boundSocketPath, close: async () => undefined } as IpcServer;
    },
    processExit,
    ...extraDeps,
  });
  return { handlers, close: runtime.close };
}

/** Drives `changeover` to create the pending transaction and returns its `handoffId`. */
export async function beginChangeover(handlers: Record<string, RpcHandler>): Promise<string> {
  const response = await handlers.changeover?.(
    { kind: "request", id: "c", method: "changeover" },
    new AbortController().signal,
  );
  if (response?.kind !== "response") throw new Error("changeover did not return a response");
  const handoffId = (response.result as { handoffId?: unknown }).handoffId;
  if (typeof handoffId !== "string") throw new Error("changeover response missing handoffId");
  return handoffId;
}
