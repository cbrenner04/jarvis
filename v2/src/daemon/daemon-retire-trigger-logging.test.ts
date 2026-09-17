import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import {
  createSignalHandler,
  formatDrainExitLogLine,
  formatHandoffSettlementLogLine,
  formatRetireTriggerLogLine,
  nextFirstRetireTrigger,
  startDrainExitLoop,
} from "./daemon.ts";
import {
  beginChangeover,
  captureConsoleError,
  startFakeDaemon,
  uniqueId,
  waitFor,
} from "./daemon-retire-trigger-logging.test-support.ts";

/** A fresh private-socket path for a `changeover`-initiated handoff. */
function makePrivateSocketPath(): string {
  return join(tmpdir(), `jarvis-retire-trigger-private-${uniqueId()}.sock`);
}

let store: StateStore;
let dbPath: string;
let socketPath: string;

beforeEach(() => {
  const unique = uniqueId();
  dbPath = join(tmpdir(), `jarvis-retire-trigger-${unique}.sqlite`);
  socketPath = join(tmpdir(), `jarvis-retire-trigger-${unique}.sock`);
  store = openStateStore(dbPath);
});

afterEach(() => {
  store.close();
  rmSync(dbPath, { force: true });
});

test("supersede logs the retire-trigger line naming supersede", async () => {
  const { handlers, close } = await startFakeDaemon(store, socketPath);
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
  const { handlers, close } = await startFakeDaemon(store, socketPath);
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
  const privateSocketPath = makePrivateSocketPath();
  const { handlers, close } = await startFakeDaemon(store, socketPath, { privateSocketPath });
  const capture = captureConsoleError();
  try {
    await handlers.changeover?.({ kind: "request", id: "c1", method: "changeover" }, new AbortController().signal);
    expect(capture.lines).toContain(formatRetireTriggerLogLine("changeover"));
  } finally {
    capture.restore();
    await close();
  }
});

test("formatHandoffSettlementLogLine includes resolution only when the caller passes one", () => {
  // Hardcoded expected strings, not built via the function under test: comparing against a
  // self-produced expectation would pass even if the `resolution === undefined` guard inverted.
  expect(formatHandoffSettlementLogLine("handoff_commit")).toBe(
    `JARVIS_DAEMON_RETIRE_TRIGGER:${JSON.stringify({ trigger: "handoff_commit" })}`,
  );
  expect(formatHandoffSettlementLogLine("handoff_fallback", "commit")).toBe(
    `JARVIS_DAEMON_RETIRE_TRIGGER:${JSON.stringify({ trigger: "handoff_fallback", resolution: "commit" })}`,
  );
});

test("handoff_commit logs the retire-trigger line naming handoff_commit before committing", async () => {
  const privateSocketPath = makePrivateSocketPath();
  const { handlers, close } = await startFakeDaemon(store, socketPath, { privateSocketPath });
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
  const privateSocketPath = makePrivateSocketPath();
  const { handlers, close } = await startFakeDaemon(store, socketPath, { privateSocketPath });
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
  const privateSocketPath = makePrivateSocketPath();
  const { handlers, close } = await startFakeDaemon(store, socketPath, { privateSocketPath, handoffFallbackMs: 20 });
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

test("a real SIGTERM drives the daemon's own signal wiring to log the retire-trigger line naming sigterm", async () => {
  const { close } = await startFakeDaemon(store, socketPath);
  const capture = captureConsoleError();
  try {
    // Emitting the event (not sending an OS signal) invokes exactly the listener
    // `startDaemonRuntime` registered via `process.on("SIGTERM", ...)`, so this exercises the real
    // `createSignalHandler` -> `recordRetireTrigger` path, not a stub.
    process.emit("SIGTERM", "SIGTERM");
    expect(capture.lines).toContain(formatRetireTriggerLogLine("sigterm"));
  } finally {
    capture.restore();
    await close();
  }
});

test("a real SIGINT drives the daemon's own signal wiring to log the retire-trigger line naming sigint", async () => {
  const { close } = await startFakeDaemon(store, socketPath);
  const capture = captureConsoleError();
  try {
    process.emit("SIGINT", "SIGINT");
    expect(capture.lines).toContain(formatRetireTriggerLogLine("sigint"));
  } finally {
    capture.restore();
    await close();
  }
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

test("startDaemonRuntime wires its own firstRetireTrigger into the drain-exit loop end to end", async () => {
  const { handlers, close } = await startFakeDaemon(store, socketPath);
  const capture = captureConsoleError();
  try {
    await handlers.supersede?.({ kind: "request", id: "s1", method: "supersede" }, new AbortController().signal);
    expect(await waitFor(() => capture.lines.includes(formatDrainExitLogLine("supersede")), 2_000)).toBe(true);
    expect(capture.lines.filter((line) => line.startsWith("JARVIS_DAEMON_DRAIN_EXIT:"))).toEqual([
      formatDrainExitLogLine("supersede"),
    ]);
  } finally {
    capture.restore();
    await close();
  }
});
