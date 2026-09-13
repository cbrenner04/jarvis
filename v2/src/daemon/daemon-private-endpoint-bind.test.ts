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
