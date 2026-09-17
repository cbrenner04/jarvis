import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type IpcServer, startIpcServer } from "../ipc/server.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { canUseUnixSockets } from "../testing/unix-socket.ts";
import { formatHandoffSettlementLogLine } from "./daemon.ts";
import {
  beginChangeover,
  captureConsoleError,
  startFakeDaemon,
  uniqueId,
  waitFor,
} from "./daemon-retire-trigger-logging.test-support.ts";

const socketTest = test.skipIf(!canUseUnixSockets());

let store: StateStore;
let dbPath: string;
let socketPath: string;

beforeEach(() => {
  const unique = uniqueId();
  dbPath = join(tmpdir(), `jarvis-retire-trigger-live-${unique}.sqlite`);
  socketPath = join(tmpdir(), `jarvis-retire-trigger-live-${unique}.sock`);
  store = openStateStore(dbPath);
});

afterEach(() => {
  store.close();
  rmSync(dbPath, { force: true });
});

socketTest("fallback timer logs handoff_fallback naming commit when a successor answers live", async () => {
  const privateSocketPath = join(tmpdir(), `jarvis-retire-trigger-live-private-${uniqueId()}.sock`);
  const { handlers, close } = await startFakeDaemon(store, socketPath, { privateSocketPath, handoffFallbackMs: 150 });
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
