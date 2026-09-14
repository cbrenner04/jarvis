import { afterEach, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { IpcClient } from "../ipc/client.ts";
import { connectIpcClient } from "../ipc/client.ts";
import { createRpcTransport } from "../ipc/rpc-transport.ts";
import { type IpcServer, type RpcHandler, startIpcServer } from "../ipc/server.ts";
import { type LogReader, openLogReader, openLogSink } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { createStableRunHandlers, createStableTailStreamHandler } from "./daemon-stable-run-routing.ts";
import { createTailStreamHandler } from "./daemon-tail-stream.ts";

const servers: IpcServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function scratchFile(label: string, ext: string): string {
  const scratch = join(process.cwd(), ".scratch");
  mkdirSync(scratch, { recursive: true });
  return join(scratch, `${label}-${process.pid}-${crypto.randomUUID()}.${ext}`);
}

function socketPath(label: string): string {
  return scratchFile(label, "sock");
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const unused: RpcHandler = () => ({ kind: "error", code: "unused", message: "unused" });

async function bindForwardingPair(ownerHandlers: Record<"wait" | "pause" | "kill", RpcHandler>) {
  const ownerPath = socketPath("run-owner");
  const stablePath = socketPath("stable-daemon");
  const owner = await startIpcServer(ownerPath, ownerHandlers);
  servers.push(owner);
  const localRefusal: RpcHandler = () => ({ kind: "error", code: "run_not_active", message: "local refusal" });
  const stableHandlers = createStableRunHandlers(
    { wait: localRefusal, pause: localRefusal, kill: localRefusal },
    {
      predecessorSocketPath: ownerPath,
      ownsRunLocally: () => false,
      resolvePredecessorOwner: async () => true,
      connectOwnerClient: connectIpcClient,
    },
  );
  const stable = await startIpcServer(stablePath, stableHandlers);
  servers.push(stable);
  const client = await connectIpcClient(stablePath);
  return { client, transport: createRpcTransport(client) };
}

test("stable-address wait remains pending until the direct predecessor settles it", async () => {
  const ownerSettlement = deferred<{ runStatus: string; loopOutcomeKind: string }>();
  let ownerWaitStarted = false;
  const wait: RpcHandler = async () => {
    ownerWaitStarted = true;
    return { kind: "response", result: await ownerSettlement.promise };
  };
  const { transport } = await bindForwardingPair({ wait, pause: unused, kill: unused });
  let settled = false;
  const pending = transport.request("wait", { runId: "draining-run" }).finally(() => {
    settled = true;
  });

  // Yield a macrotask per check: a microtask-only spin starves socket I/O and never reaches the owner.
  while (!ownerWaitStarted) await Bun.sleep(1);
  expect(settled).toBe(false);
  ownerSettlement.resolve({ runStatus: "completed", loopOutcomeKind: "complete" });
  expect(await pending).toEqual({ runStatus: "completed", loopOutcomeKind: "complete" });
  transport.close();
});

test("stable-address kill preserves force and aborts the direct predecessor invocation", async () => {
  const invocation = new AbortController();
  let receivedParams: unknown;
  const kill: RpcHandler = (request) => {
    receivedParams = request.params;
    invocation.abort();
    return {
      kind: "response",
      result: { ok: true, outcome: "force-settled", runId: "draining-run", status: "killed", survivors: [] },
    };
  };
  const { transport } = await bindForwardingPair({ wait: unused, pause: unused, kill });

  expect(await transport.request("kill", { runId: "draining-run", force: true })).toEqual({
    ok: true,
    outcome: "force-settled",
    runId: "draining-run",
    status: "killed",
    survivors: [],
  });
  expect(receivedParams).toEqual({ runId: "draining-run", force: true });
  expect(invocation.signal.aborted).toBe(true);
  transport.close();
});

/** A local tail handler backed by an unrelated, always-empty store: proves an assertion exercises
 * forwarding to the owner rather than a coincidentally-matching local read. */
function neverLocalTailHandler() {
  return createTailStreamHandler({
    stateStore: { loadRun: () => undefined } as unknown as StateStore,
    logReader: { tail: () => [], async *follow() {} },
  });
}

type TailForwardingPair = {
  client: IpcClient;
  runId: string;
  ownerStore: StateStore;
  ownerLogSink: ReturnType<typeof openLogSink>;
  cleanup: () => Promise<void>;
};

async function bindTailForwardingPair(ownerReader?: (base: LogReader) => LogReader): Promise<TailForwardingPair> {
  const ownerPath = socketPath("tail-owner");
  const stablePath = socketPath("tail-stable");
  const dbPath = scratchFile("tail-owner-db", "db");
  const logsPath = scratchFile("tail-owner-logs", "jsonl");

  const ownerStore = openStateStore(dbPath);
  const runId = ownerStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-worktree",
    branch: "test-branch",
    specPath: "/tmp/test-project/spec.md",
  });
  const ownerLogSink = openLogSink(logsPath);
  const baseReader = openLogReader(logsPath, 20);
  const ownerLogReader = ownerReader?.(baseReader) ?? baseReader;
  const ownerTailHandler = createTailStreamHandler({
    stateStore: ownerStore,
    logReader: ownerLogReader,
    followStatusPollMs: 20,
  });
  const owner = await startIpcServer(ownerPath, {}, ownerTailHandler);
  servers.push(owner);

  const stableHandler = createStableTailStreamHandler(neverLocalTailHandler(), {
    predecessorSocketPath: ownerPath,
    ownsRunLocally: () => false,
    resolvePredecessorOwner: async () => true,
    connectOwnerClient: connectIpcClient,
  });
  const stable = await startIpcServer(stablePath, {}, stableHandler);
  servers.push(stable);

  const client = await connectIpcClient(stablePath);
  return {
    client,
    runId,
    ownerStore,
    ownerLogSink,
    cleanup: async () => {
      client.close();
      ownerLogSink.close();
      ownerStore.close();
      rmSync(logsPath, { force: true });
      rmSync(dbPath, { force: true });
    },
  };
}

async function collectStream(
  client: IpcClient,
  streamId: string,
  payload: unknown,
): Promise<{ records: unknown[]; error: string | undefined }> {
  client.send({ kind: "stream-open", streamId, payload });
  const records: unknown[] = [];
  while (true) {
    const frame = await client.nextFrame();
    if (frame.kind === "stream-data" && frame.streamId === streamId) {
      records.push(JSON.parse(frame.payload as string));
      continue;
    }
    if (frame.kind === "stream-end" && frame.streamId === streamId) {
      const errorPayload = frame.payload as { error?: string } | undefined;
      return { records, error: errorPayload?.error };
    }
  }
}

test("tail replay through the stable address returns the direct predecessor owner's records in order", async () => {
  const { client, runId, ownerLogSink, cleanup } = await bindTailForwardingPair();
  try {
    ownerLogSink.append(runId, { kind: "iteration_started", attemptId: "attempt-1" });
    ownerLogSink.append(runId, {
      kind: "boundary_committed",
      attemptId: "attempt-1",
      outcomeKind: "progress",
      runStatus: "in-progress",
    });

    const { records, error } = await collectStream(client, "replay-stream", { runId, afterSeq: 0 });

    expect(error).toBeUndefined();
    expect(records).toHaveLength(2);
    expect((records[0] as { seq: number }).seq).toBe(1);
    expect((records[1] as { seq: number }).seq).toBe(2);
  } finally {
    await cleanup();
  }
});

test("tail follow through the stable address forwards records the owner emits after open and ends normally when the owner stream ends", async () => {
  const { client, runId, ownerStore, ownerLogSink, cleanup } = await bindTailForwardingPair();
  try {
    const collecting = collectStream(client, "follow-stream", { runId, afterSeq: 0, follow: true });

    // Give the owner's follow loop time to start polling before appending, then let it settle.
    await Bun.sleep(30);
    ownerLogSink.append(runId, { kind: "iteration_started", attemptId: "attempt-1" });
    await Bun.sleep(30);
    ownerStore.setRunStatus(runId, "completed");

    const { records, error } = await collecting;

    expect(error).toBeUndefined();
    expect(records).toHaveLength(1);
    expect((records[0] as { event: { kind: string } }).event.kind).toBe("iteration_started");
  } finally {
    await cleanup();
  }
});

test("caller cancellation aborts the owner-side stream handler's follow signal, leaving no open follow", async () => {
  let ownerFollowSignal: AbortSignal | undefined;
  const { client, runId, cleanup } = await bindTailForwardingPair((base) => ({
    tail: (id: string) => base.tail(id),
    follow(id: string, signal?: AbortSignal) {
      ownerFollowSignal = signal;
      return base.follow(id, signal);
    },
  }));
  try {
    const streamId = "cancel-stream";
    client.send({ kind: "stream-open", streamId, payload: { runId, afterSeq: 0, follow: true } });

    while (ownerFollowSignal === undefined) await Bun.sleep(5);
    expect(ownerFollowSignal.aborted).toBe(false);

    client.send({ kind: "stream-end", streamId });
    while (!ownerFollowSignal.aborted) await Bun.sleep(5);
    expect(ownerFollowSignal.aborted).toBe(true);
  } finally {
    await cleanup();
  }
});

test("owner disconnect mid-follow ends the caller stream with an error, not a successful end", async () => {
  const { client, runId, ownerLogSink, cleanup } = await bindTailForwardingPair();
  // `bindTailForwardingPair` just pushed exactly [owner, stable]; splice the owner out of the
  // shared teardown list so this test can close it early itself.
  const ownerIndex = servers.length - 2;
  const ownerServer = servers[ownerIndex];
  try {
    ownerLogSink.append(runId, { kind: "iteration_started", attemptId: "attempt-1" });

    const streamId = "disconnect-stream";
    client.send({ kind: "stream-open", streamId, payload: { runId, afterSeq: 0, follow: true } });

    let frame = await client.nextFrame();
    while (!(frame.kind === "stream-data" && frame.streamId === streamId)) {
      frame = await client.nextFrame();
    }

    servers.splice(ownerIndex, 1);
    await ownerServer?.close({ drainTimeoutMs: 50 });

    frame = await client.nextFrame();
    while (!(frame.kind === "stream-end" && frame.streamId === streamId)) {
      frame = await client.nextFrame();
    }
    const errorPayload = frame.payload as { error?: string } | undefined;
    expect(typeof errorPayload?.error).toBe("string");
  } finally {
    await cleanup();
  }
});
