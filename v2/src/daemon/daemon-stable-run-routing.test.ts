import { describe, expect, test } from "bun:test";
import type { IpcClient } from "../ipc/client.ts";
import type { RpcHandler } from "../ipc/server.ts";
import type { IpcFrame } from "../ipc/types.ts";
import { createStableRunHandlers } from "./daemon-stable-run-routing.ts";

type Reply = { kind: "response"; result: unknown } | { kind: "error"; code: string; message: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function ownerClient(reply?: Reply, sendError?: Error) {
  const next = deferred<IpcFrame>();
  const afterReply = deferred<IpcFrame>();
  void next.promise.catch(() => undefined);
  void afterReply.promise.catch(() => undefined);
  const sent: unknown[] = [];
  let closeCount = 0;
  let requestId: string | undefined;
  let delivered = false;
  const client: IpcClient = {
    send(frame) {
      if (sendError !== undefined) throw sendError;
      sent.push(frame);
      requestId = (frame as { id?: string }).id;
      if (reply !== undefined && requestId !== undefined) {
        next.resolve({ ...reply, id: requestId } as IpcFrame);
      }
    },
    nextFrame: () => {
      if (!delivered) {
        delivered = true;
        return next.promise;
      }
      return afterReply.promise;
    },
    close() {
      closeCount += 1;
      const error = new Error("connection closed");
      next.reject(error);
      afterReply.reject(error);
    },
  };
  return {
    client,
    sent,
    closeCount: () => closeCount,
    respond(replyFrame: Reply) {
      if (requestId === undefined) throw new Error("request not sent");
      next.resolve({ ...replyFrame, id: requestId } as IpcFrame);
    },
  };
}

async function waitUntilSent(owner: ReturnType<typeof ownerClient>): Promise<void> {
  for (let turn = 0; turn < 10 && owner.sent.length === 0; turn += 1) await Promise.resolve();
  expect(owner.sent).toHaveLength(1);
}

function localHandlers(calls: string[]): Record<"wait" | "pause" | "kill", RpcHandler> {
  const local =
    (method: string): RpcHandler =>
    (frame) => {
      calls.push(method);
      return { kind: "response", result: { local: true, params: frame.params } };
    };
  return { wait: local("wait"), pause: local("pause"), kill: local("kill") };
}

function frame(method: "wait" | "pause" | "kill", params: unknown = { runId: "run-1" }) {
  return { kind: "request", id: `request-${method}`, method, params } as const;
}

async function rejectsConnect(): Promise<never> {
  throw new Error("must not connect");
}

const PREDECESSOR_SOCKET_PATH = "/private/predecessor.sock";

describe("stable run unary routing", () => {
  test("defers initial-empty ownership until refresh and routes to the direct owner", async () => {
    const refresh = deferred<boolean>();
    const owner = ownerClient({ kind: "response", result: { settled: true } });
    const localCalls: string[] = [];
    const handlers = createStableRunHandlers(localHandlers(localCalls), {
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      ownsRunLocally: () => false,
      resolvePredecessorOwner: () => refresh.promise,
      connectOwnerClient: async () => owner.client,
    });

    const pending = handlers.wait(frame("wait"), new AbortController().signal);
    await Promise.resolve();
    expect(localCalls).toEqual([]);
    expect(owner.sent).toEqual([]);
    refresh.resolve(true);

    expect(await pending).toEqual({ kind: "response", result: { settled: true } });
    expect(owner.sent[0]).toMatchObject({ kind: "request", method: "wait", params: { runId: "run-1" } });
    expect(owner.closeCount()).toBe(1);
  });

  test("a transiently cleared snapshot refreshes to the owner without local refusal", async () => {
    let refreshes = 0;
    const owner = ownerClient({ kind: "response", result: { ok: true } });
    const localCalls: string[] = [];
    const handlers = createStableRunHandlers(localHandlers(localCalls), {
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      ownsRunLocally: () => false,
      resolvePredecessorOwner: async () => {
        refreshes += 1;
        return true;
      },
      connectOwnerClient: async () => owner.client,
    });

    expect(await handlers.kill(frame("kill"), new AbortController().signal)).toEqual({
      kind: "response",
      result: { ok: true },
    });
    expect(refreshes).toBe(1);
    expect(localCalls).toEqual([]);
  });

  test("failed ownership refresh returns an error without local handling", async () => {
    const localCalls: string[] = [];
    const handlers = createStableRunHandlers(localHandlers(localCalls), {
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      ownsRunLocally: () => false,
      resolvePredecessorOwner: async () => {
        throw new Error("ownership refresh failed");
      },
      connectOwnerClient: rejectsConnect,
    });

    await expect(handlers.wait(frame("wait"), new AbortController().signal)).rejects.toThrow(
      "ownership refresh failed",
    );
    expect(localCalls).toEqual([]);
  });

  test("current owner wins and definitively unowned requests stay local", async () => {
    const localCalls: string[] = [];
    let resolves = 0;
    const local = localHandlers(localCalls);
    const current = createStableRunHandlers(local, {
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      ownsRunLocally: () => true,
      resolvePredecessorOwner: async () => {
        resolves += 1;
        return true;
      },
      connectOwnerClient: rejectsConnect,
    });
    const unowned = createStableRunHandlers(local, {
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      ownsRunLocally: () => false,
      resolvePredecessorOwner: async () => {
        resolves += 1;
        return false;
      },
      connectOwnerClient: rejectsConnect,
    });

    await current.pause(frame("pause"), new AbortController().signal);
    await unowned.kill(frame("kill"), new AbortController().signal);
    expect(localCalls).toEqual(["pause", "kill"]);
    expect(resolves).toBe(1);
  });

  test("rechecks current ownership after refresh before forwarding", async () => {
    const refresh = deferred<boolean>();
    const localCalls: string[] = [];
    let localOwner = false;
    const handlers = createStableRunHandlers(localHandlers(localCalls), {
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      ownsRunLocally: () => localOwner,
      resolvePredecessorOwner: () => refresh.promise,
      connectOwnerClient: rejectsConnect,
    });

    const pending = handlers.wait(frame("wait"), new AbortController().signal);
    localOwner = true;
    refresh.resolve(true);
    expect(await pending).toMatchObject({ kind: "response", result: { local: true } });
    expect(localCalls).toEqual(["wait"]);
  });

  test("pause preserves complete params and owner application errors unchanged", async () => {
    const owner = ownerClient({ kind: "error", code: "owner_refusal", message: "owner says no" });
    const handlers = createStableRunHandlers(localHandlers([]), {
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      ownsRunLocally: () => false,
      resolvePredecessorOwner: async () => true,
      connectOwnerClient: async () => owner.client,
    });
    const params = { runId: "run-1", futureField: { preserved: true } };

    expect(await handlers.pause(frame("pause", params), new AbortController().signal)).toEqual({
      kind: "error",
      code: "owner_refusal",
      message: "owner says no",
    });
    expect(owner.sent[0]).toMatchObject({ method: "pause", params });
    expect(owner.closeCount()).toBe(1);
  });

  test("closes private transports after send failure and caller cancellation", async () => {
    const sendFailure = ownerClient(undefined, new Error("send failed"));
    const cancelled = ownerClient();
    const clients = [sendFailure, cancelled];
    const handlers = createStableRunHandlers(localHandlers([]), {
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      ownsRunLocally: () => false,
      resolvePredecessorOwner: async () => true,
      connectOwnerClient: async () => {
        const next = clients.shift();
        if (next === undefined) throw new Error("missing client");
        return next.client;
      },
    });

    await expect(handlers.kill(frame("kill"), new AbortController().signal)).rejects.toThrow("IPC connection lost");
    expect(sendFailure.closeCount()).toBe(1);

    const controller = new AbortController();
    const pending = handlers.wait(frame("wait"), controller.signal);
    await waitUntilSent(cancelled);
    controller.abort();
    await expect(pending).rejects.toThrow("IPC connection lost");
    expect(cancelled.closeCount()).toBe(1);
  });

  test("an already-cancelled request closes its private transport without sending", async () => {
    const owner = ownerClient();
    const handlers = createStableRunHandlers(localHandlers([]), {
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      ownsRunLocally: () => false,
      resolvePredecessorOwner: async () => true,
      connectOwnerClient: async () => owner.client,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(handlers.wait(frame("wait"), controller.signal)).rejects.toThrow("request aborted");
    expect(owner.sent).toEqual([]);
    expect(owner.closeCount()).toBe(1);
  });

  test("concurrent waits own independent transports and cancellation closes only its wait", async () => {
    const first = ownerClient();
    const second = ownerClient();
    const clients = [first, second];
    const handlers = createStableRunHandlers(localHandlers([]), {
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      ownsRunLocally: () => false,
      resolvePredecessorOwner: async () => true,
      connectOwnerClient: async () => {
        const next = clients.shift();
        if (next === undefined) throw new Error("missing client");
        return next.client;
      },
    });
    const firstAbort = new AbortController();
    const secondAbort = new AbortController();
    const firstWait = handlers.wait(frame("wait", { runId: "run-1" }), firstAbort.signal);
    const secondWait = handlers.wait(frame("wait", { runId: "run-2" }), secondAbort.signal);
    await waitUntilSent(first);
    await waitUntilSent(second);

    firstAbort.abort();
    await expect(firstWait).rejects.toThrow("IPC connection lost");
    expect(first.closeCount()).toBe(1);
    expect(second.closeCount()).toBe(0);
    second.respond({ kind: "response", result: { runStatus: "completed" } });
    expect(await secondWait).toEqual({ kind: "response", result: { runStatus: "completed" } });
    expect(second.closeCount()).toBe(1);
  });
});
