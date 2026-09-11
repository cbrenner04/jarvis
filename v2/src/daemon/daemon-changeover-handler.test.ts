// Guard coverage for the changeover handoff wired into `startDaemonRuntime`: the outgoing side's
// `changeover` RPC handler (admission cutoff, private-endpoint reply, public release) and the
// incoming side's pre-bind handoff request (abort-before-bind on a failed handoff). Real two-
// generation socket coverage lives in `changeover-handoff.sandbox-unrunnable.test.ts`.

import { expect, test } from "bun:test";
import type { IpcServer, RpcHandler } from "../ipc/server.ts";
import type { LogReader, LogSink } from "../persistence/log-stream.ts";
import type { StateStore } from "../persistence/state-store.ts";
import { mockWriteLoopInput } from "../testing/run-control.ts";
import { startDaemonRuntime } from "./daemon.ts";
import type { ChangeoverOutcome } from "./daemon-peer-socket.ts";

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

class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`process exit ${code}`);
  }
}

function throwingProcessExit(code: number): never {
  throw new ExitSignal(code);
}

function requestFrame(method: string): { kind: "request"; id: string; method: string } {
  return { kind: "request", id: "r1", method };
}

test("changeover handler retires, releases the public server, and reports the private endpoint", async () => {
  const boundPaths: string[] = [];
  const closedPaths: string[] = [];
  let capturedHandlers: Record<string, RpcHandler> | undefined;
  const startIpcServer = async (socketPath: string, handlers?: Record<string, RpcHandler>): Promise<IpcServer> => {
    boundPaths.push(socketPath);
    if (socketPath === "/fake/public.sock") capturedHandlers = handlers;
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

  const handlers = capturedHandlers;
  if (!handlers) throw new Error("handlers were not captured");

  const response = await handlers.changeover?.(requestFrame("changeover"), new AbortController().signal);
  expect(response).toEqual({ kind: "response", result: { privateSocketPath: "/fake/private.sock" } });
  // The public server is released without waiting on its drain; the private server is untouched.
  expect(closedPaths).toEqual(["/fake/public.sock"]);

  // Admission is cut off before the reply above, so a `start` after it observes `daemon_superseded`.
  const startResponse = await handlers.start?.(
    { kind: "request", id: "s1", method: "start", params: { input: mockWriteLoopInput() } },
    new AbortController().signal,
  );
  expect(startResponse).toMatchObject({ kind: "error", code: "daemon_superseded" });

  await runtime.close();
});

test("a live peer that never completes the handoff aborts startup without binding the public address", async () => {
  const boundPaths: string[] = [];
  const startIpcServer = async (socketPath: string): Promise<IpcServer> => {
    boundPaths.push(socketPath);
    return { socketPath, close: async () => undefined };
  };
  const requestChangeoverFromPublicPeer = async (): Promise<ChangeoverOutcome> => ({
    kind: "handoff-failed",
    reason: "timed out",
  });

  await expect(
    startDaemonRuntime("/fake/public.sock", fakeStore(), fakeReader(), {
      openLogSink: () => fakeSink(),
      startIpcServer,
      privateSocketPath: "/fake/private.sock",
      requestChangeoverFromPublicPeer,
      processExit: throwingProcessExit,
    }),
  ).rejects.toThrow(ExitSignal);

  // The private endpoint is bound (it does not race the public address), but the incumbent's
  // public socket is never touched: no bind is even attempted there.
  expect(boundPaths).toEqual(["/fake/private.sock"]);
});

test("a fresh start (no peer) and a completed handoff both proceed to bind the public address", async () => {
  for (const outcome of [{ kind: "no-peer" as const }, { kind: "handoff-complete" as const }]) {
    const boundPaths: string[] = [];
    const startIpcServer = async (socketPath: string): Promise<IpcServer> => {
      boundPaths.push(socketPath);
      return { socketPath, close: async () => undefined };
    };
    const requestChangeoverFromPublicPeer = async (): Promise<ChangeoverOutcome> => outcome;

    const runtime = await startDaemonRuntime("/fake/public.sock", fakeStore(), fakeReader(), {
      openLogSink: () => fakeSink(),
      startIpcServer,
      requestChangeoverFromPublicPeer,
    });

    expect(boundPaths).toEqual(["/fake/public.sock"]);
    await runtime.close();
  }
});
