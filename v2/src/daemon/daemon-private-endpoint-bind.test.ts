import { expect, test } from "bun:test";
import type { IpcServer, RpcHandler } from "../ipc/server.ts";
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
      return { ownerRow: () => undefined, stop: () => undefined };
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
      return { ownerRow: () => undefined, stop: () => undefined };
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
    observeRunOwnership: () => ({
      ownerRow: () => undefined,
      resolveOwner: async () => true,
      stop: () => undefined,
    }),
    connectRunOwnerClient: async () => {
      throw new Error("private handler must not forward");
    },
  });

  const privatePause = boundHandlers.get("/fake/private.sock")?.pause;
  const publicPause = boundHandlers.get("/fake/public.sock")?.pause;
  expect(privatePause).toBeDefined();
  expect(publicPause).toBeDefined();
  expect(privatePause).not.toBe(publicPause);
  expect(await privatePause?.({ kind: "request", id: "pause", method: "pause" }, new AbortController().signal)).toEqual(
    { kind: "error", code: "invalid_params", message: "Missing runId" },
  );

  await runtime.close();
});
