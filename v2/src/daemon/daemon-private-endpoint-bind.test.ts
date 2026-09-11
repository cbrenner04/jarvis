// Guard coverage for the `startupDeps.privateSocketPath` conditional bind in `startDaemonRuntime`:
// the private digest-keyed endpoint binds before the public socket only when a private path is
// injected, and its server is closed on shutdown only when it was bound.

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

test("binds only the public socket when no privateSocketPath is injected", async () => {
  const boundPaths: string[] = [];
  const closedPaths: string[] = [];
  const startIpcServer = async (socketPath: string, _handlers?: Record<string, RpcHandler>): Promise<IpcServer> => {
    boundPaths.push(socketPath);
    return {
      socketPath,
      close: async () => {
        closedPaths.push(socketPath);
      },
    };
  };

  const runtime = await startDaemonRuntime("/fake/public.sock", fakeStore(), fakeReader(), {
    openLogSink: () => fakeSink(),
    startIpcServer,
  });

  expect(boundPaths).toEqual(["/fake/public.sock"]);
  await runtime.close();
  expect(closedPaths).toEqual(["/fake/public.sock"]);
});

test("binds the private endpoint before the public socket when privateSocketPath is injected, and closes both on shutdown", async () => {
  const boundPaths: string[] = [];
  const closedPaths: string[] = [];
  const startIpcServer = async (socketPath: string, _handlers?: Record<string, RpcHandler>): Promise<IpcServer> => {
    boundPaths.push(socketPath);
    return {
      socketPath,
      close: async () => {
        closedPaths.push(socketPath);
      },
    };
  };

  const runtime = await startDaemonRuntime("/fake/public.sock", fakeStore(), fakeReader(), {
    openLogSink: () => fakeSink(),
    startIpcServer,
    privateSocketPath: "/fake/private.sock",
  });

  expect(boundPaths).toEqual(["/fake/private.sock", "/fake/public.sock"]);
  await runtime.close();
  expect(closedPaths).toEqual(["/fake/public.sock", "/fake/private.sock"]);
});
