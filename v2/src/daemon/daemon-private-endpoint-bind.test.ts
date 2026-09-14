import { expect, test } from "bun:test";
import type { IpcServer, RpcHandler, StreamHandler } from "../ipc/server.ts";
import type { LogReader, LogSink } from "../persistence/log-stream.ts";
import type { StateStore } from "../persistence/state-store.ts";
import { startDaemonRuntime } from "./daemon.ts";

function fakeStore(): StateStore {
  return {
    beginRunReconciliation: async () => [],
    finishRunReconciliation: () => undefined,
    listReadyGateSweepCandidates: async () => [],
    listPipelines: () => [],
    listRuns: () => [],
    loadRun: () => undefined,
    listIncidentCandidatePipelines: () => [],
    listIncidentCandidateRuns: () => [],
    loadRunsByIds: () => [],
    findRunsByInvocationIds: () => [],
    isClosed: () => false,
    hasNotificationDelivery: () => false,
    listNotificationDeliveriesForIncidentIds: () => [],
    tryRecordNotificationDelivery: () => true,
    reconcilePipelines: async () => [],
  } as unknown as StateStore;
}

function fakeReader(): LogReader {
  return { tail: () => [], async *follow() {} };
}

function fakeSink(): LogSink {
  return { append: () => undefined, close: () => undefined };
}

function fakeServer(boundPaths: string[], closedPaths: string[]) {
  return async (socketPath: string, _handlers?: Record<string, RpcHandler>): Promise<IpcServer> => {
    boundPaths.push(socketPath);
    return { socketPath, close: async () => void closedPaths.push(socketPath) };
  };
}

test("binds only the public socket when no private path is injected", async () => {
  const boundPaths: string[] = [];
  const closedPaths: string[] = [];
  let excludedPeerPath: string | undefined;
  const runtime = await startDaemonRuntime("/fake/public.sock", fakeStore(), fakeReader(), {
    openLogSink: () => fakeSink(),
    startIpcServer: fakeServer(boundPaths, closedPaths),
    enumerateOtherDaemonSockets: (_home, ownPath) => {
      excludedPeerPath = ownPath;
      return [];
    },
  });

  expect(boundPaths).toEqual(["/fake/public.sock"]);
  expect(excludedPeerPath).toBe("/fake/public.sock");
  await runtime.close();
  expect(closedPaths).toEqual(["/fake/public.sock"]);
});

test("binds private before public and excludes its own private endpoint from peers", async () => {
  const boundPaths: string[] = [];
  const closedPaths: string[] = [];
  let excludedPeerPath: string | undefined;
  const runtime = await startDaemonRuntime("/fake/public.sock", fakeStore(), fakeReader(), {
    openLogSink: () => fakeSink(),
    startIpcServer: fakeServer(boundPaths, closedPaths),
    privateSocketPath: "/fake/private.sock",
    enumerateOtherDaemonSockets: (_home, ownPath) => {
      excludedPeerPath = ownPath;
      return [];
    },
  });

  expect(boundPaths).toEqual(["/fake/private.sock", "/fake/public.sock"]);
  expect(excludedPeerPath).toBe("/fake/private.sock");
  await runtime.close();
  expect(closedPaths).toEqual(["/fake/public.sock", "/fake/private.sock"]);
});

test("wires each discovered legacy peer socket into drain observation, never its own private endpoint", async () => {
  const observedSocketPaths: string[] = [];
  const stoppedSocketPaths: string[] = [];
  const runtime = await startDaemonRuntime("/fake/public.sock", fakeStore(), fakeReader(), {
    openLogSink: () => fakeSink(),
    startIpcServer: fakeServer([], []),
    privateSocketPath: "/fake/private.sock",
    enumerateOtherDaemonSockets: () => ["/fake/legacy-a.sock", "/fake/legacy-b.sock"],
    observePredecessorDrain: (socketPath) => {
      observedSocketPaths.push(socketPath);
      return { liveRunIds: () => new Set<string>(), stop: () => void stoppedSocketPaths.push(socketPath) };
    },
  });

  expect(observedSocketPaths).toEqual(["/fake/legacy-a.sock", "/fake/legacy-b.sock"]);
  expect(observedSocketPaths).not.toContain("/fake/private.sock");
  await runtime.close();
  expect(stoppedSocketPaths).toEqual(["/fake/legacy-a.sock", "/fake/legacy-b.sock"]);
});

test("wires a real handoff predecessor into drain observation alongside any legacy peers", async () => {
  const observedSocketPaths: string[] = [];
  const runtime = await startDaemonRuntime("/fake/public.sock", fakeStore(), fakeReader(), {
    openLogSink: () => fakeSink(),
    startIpcServer: fakeServer([], []),
    predecessorSocketPath: "/fake/predecessor.sock",
    enumerateOtherDaemonSockets: () => ["/fake/legacy.sock"],
    observePredecessorDrain: (socketPath) => {
      observedSocketPaths.push(socketPath);
      return { liveRunIds: () => new Set<string>(), stop: () => undefined };
    },
  });

  expect(observedSocketPaths).toEqual(["/fake/predecessor.sock", "/fake/legacy.sock"]);
  await runtime.close();
});

test("feeds only predecessorSocketPath into ownership routing, never a legacy peer socket", async () => {
  const ownershipSocketPaths: (string | undefined)[] = [];
  const runtime = await startDaemonRuntime("/fake/public.sock", fakeStore(), fakeReader(), {
    openLogSink: () => fakeSink(),
    startIpcServer: fakeServer([], []),
    predecessorSocketPath: "/fake/predecessor.sock",
    enumerateOtherDaemonSockets: () => ["/fake/legacy.sock"],
    observePredecessorDrain: () => ({ liveRunIds: () => new Set<string>(), stop: () => undefined }),
    observeRunOwnership: (predecessorSocketPath) => {
      ownershipSocketPaths.push(predecessorSocketPath);
      return { ownerRow: () => undefined, resolveOwner: async () => false, stop: () => undefined };
    },
  });

  // A naive implementation sourcing ownership from `buildDrainObservers`'s combined socket list
  // would call this once per socket, including the legacy peer; only the direct predecessor may.
  expect(ownershipSocketPaths).toEqual(["/fake/predecessor.sock"]);
  await runtime.close();
});

test("ownership routing gets no socket path when only legacy peers are discovered, with no real predecessor", async () => {
  const ownershipSocketPaths: (string | undefined)[] = [];
  const runtime = await startDaemonRuntime("/fake/public.sock", fakeStore(), fakeReader(), {
    openLogSink: () => fakeSink(),
    startIpcServer: fakeServer([], []),
    enumerateOtherDaemonSockets: () => ["/fake/legacy-a.sock", "/fake/legacy-b.sock"],
    observePredecessorDrain: () => ({ liveRunIds: () => new Set<string>(), stop: () => undefined }),
    observeRunOwnership: (predecessorSocketPath) => {
      ownershipSocketPaths.push(predecessorSocketPath);
      return { ownerRow: () => undefined, resolveOwner: async () => false, stop: () => undefined };
    },
  });

  expect(ownershipSocketPaths).toEqual([undefined]);
  await runtime.close();
});

test("stops the ownership directory on close", async () => {
  let stopped = false;
  const runtime = await startDaemonRuntime("/fake/public.sock", fakeStore(), fakeReader(), {
    openLogSink: () => fakeSink(),
    startIpcServer: fakeServer([], []),
    predecessorSocketPath: "/fake/predecessor.sock",
    observeRunOwnership: () => ({
      ownerRow: () => undefined,
      resolveOwner: async () => false,
      stop: () => {
        stopped = true;
      },
    }),
  });

  await runtime.close();
  expect(stopped).toBe(true);
});

test("binds direct-owner routing only on the stable endpoint so private calls cannot chain", async () => {
  const boundHandlers = new Map<string, Record<string, RpcHandler>>();
  const ownerConnectAttempts: string[] = [];
  const runtime = await startDaemonRuntime("/fake/public.sock", fakeStore(), fakeReader(), {
    openLogSink: () => fakeSink(),
    startIpcServer: async (socketPath, handlers = {}) => {
      boundHandlers.set(socketPath, handlers);
      return { socketPath, close: async () => undefined };
    },
    privateSocketPath: "/fake/private.sock",
    predecessorSocketPath: "/fake/predecessor.sock",
    enumerateOtherDaemonSockets: () => [],
    observePredecessorDrain: () => ({ liveRunIds: () => new Set<string>(), stop: () => undefined }),
    // Resolves every runId to the predecessor: a routing handler would forward, the local handler
    // never consults this at all.
    observeRunOwnership: () => ({
      ownerRow: () => undefined,
      resolveOwner: async () => true,
      stop: () => undefined,
    }),
    connectRunOwnerClient: async (socketPath) => {
      ownerConnectAttempts.push(socketPath);
      throw new Error("no real owner in this test");
    },
  });

  const privatePause = boundHandlers.get("/fake/private.sock")?.pause;
  const publicPause = boundHandlers.get("/fake/public.sock")?.pause;
  expect(privatePause).toBeDefined();
  expect(publicPause).toBeDefined();
  expect(privatePause).not.toBe(publicPause);

  const request = { kind: "request", id: "pause", method: "pause", params: { runId: "run-1" } } as const;

  // The private endpoint runs the local handler directly and never resolves ownership at all: an
  // unknown run yields the local `unknown_run` error rather than an attempted forward.
  expect(await privatePause?.(request, new AbortController().signal)).toEqual({
    kind: "error",
    code: "unknown_run",
    message: "Run run-1 not found",
  });
  expect(ownerConnectAttempts).toEqual([]);

  // The same request through the stable endpoint resolves ownership to the predecessor and
  // forwards, proving the private endpoint above skipped routing rather than merely finding no
  // owner. This fails if the private endpoint ever gets the routing handlers instead of the local
  // ones.
  await expect(publicPause?.(request, new AbortController().signal)).rejects.toThrow("no real owner in this test");
  expect(ownerConnectAttempts).toEqual(["/fake/predecessor.sock"]);

  await runtime.close();
});

test("stream path performs no ownership lookup when no predecessor is configured", async () => {
  const boundStreamHandlers = new Map<string, StreamHandler | undefined>();
  const runtime = await startDaemonRuntime("/fake/public.sock", fakeStore(), fakeReader(), {
    openLogSink: () => fakeSink(),
    startIpcServer: async (socketPath, _handlers, streamHandler) => {
      boundStreamHandlers.set(socketPath, streamHandler);
      return { socketPath, close: async () => undefined };
    },
    privateSocketPath: "/fake/private.sock",
    enumerateOtherDaemonSockets: () => [],
  });

  // No predecessor configured: the public endpoint gets the exact same unwrapped local handler as
  // the private endpoint, proving no direct-owner ownership check ever runs on the stream path.
  expect(boundStreamHandlers.get("/fake/public.sock")).toBe(boundStreamHandlers.get("/fake/private.sock"));
  await runtime.close();
});

test("binds direct-owner stream routing only on the stable endpoint so private tail calls cannot chain", async () => {
  const boundStreamHandlers = new Map<string, StreamHandler | undefined>();
  const ownerConnectAttempts: string[] = [];
  const runtime = await startDaemonRuntime("/fake/public.sock", fakeStore(), fakeReader(), {
    openLogSink: () => fakeSink(),
    startIpcServer: async (socketPath, _handlers, streamHandler) => {
      boundStreamHandlers.set(socketPath, streamHandler);
      return { socketPath, close: async () => undefined };
    },
    privateSocketPath: "/fake/private.sock",
    predecessorSocketPath: "/fake/predecessor.sock",
    enumerateOtherDaemonSockets: () => [],
    observePredecessorDrain: () => ({ liveRunIds: () => new Set<string>(), stop: () => undefined }),
    // Resolves every runId to the predecessor: a routing handler would forward, the local handler
    // never consults this at all.
    observeRunOwnership: () => ({
      ownerRow: () => undefined,
      resolveOwner: async () => true,
      stop: () => undefined,
    }),
    connectRunOwnerClient: async (socketPath) => {
      ownerConnectAttempts.push(socketPath);
      throw new Error("no real owner in this test");
    },
  });

  const privateStream = boundStreamHandlers.get("/fake/private.sock");
  const publicStream = boundStreamHandlers.get("/fake/public.sock");
  expect(privateStream).toBeDefined();
  expect(publicStream).toBeDefined();
  expect(privateStream).not.toBe(publicStream);

  const onData: unknown[] = [];
  let closed = 0;
  // The private endpoint runs the local handler directly and never resolves ownership at all: an
  // unknown run just closes locally without any stream-data.
  await privateStream?.(
    "s1",
    { runId: "unknown-run" },
    (record) => onData.push(record),
    () => (closed += 1),
    new AbortController().signal,
  );
  expect(onData).toEqual([]);
  expect(closed).toBe(1);
  expect(ownerConnectAttempts).toEqual([]);

  // The same request through the stable endpoint resolves ownership to the predecessor and
  // attempts to forward, proving the private endpoint above skipped routing rather than merely
  // finding no owner.
  await expect(
    publicStream?.(
      "s2",
      { runId: "run-1" },
      () => undefined,
      () => undefined,
      new AbortController().signal,
    ),
  ).rejects.toThrow("no real owner in this test");
  expect(ownerConnectAttempts).toEqual(["/fake/predecessor.sock"]);

  await runtime.close();
});
