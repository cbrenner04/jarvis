import { describe, expect, test } from "bun:test";
import type { IpcClient } from "../ipc/client.ts";
import type { RpcHandler, StreamHandler } from "../ipc/server.ts";
import type { IpcFrame } from "../ipc/types.ts";
import { spinUntilMicrotask } from "../testing/bounded-microtask-spin.ts";
import { createStableRunHandlers, createStableTailStreamHandler } from "./daemon-stable-run-routing.ts";

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

/** Routes every run to `owner` with an inert local handler, for tests that only exercise forwarding. */
function forwardingRunHandlers(owner: ReturnType<typeof ownerClient>) {
  return createStableRunHandlers(localHandlers([]), {
    predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
    ownsRunLocally: () => false,
    resolvePredecessorOwner: async () => true,
    connectOwnerClient: async () => owner.client,
  });
}

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
    const handlers = forwardingRunHandlers(owner);
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
    const handlers = forwardingRunHandlers(owner);
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

function streamOwnerClient() {
  const outgoing: unknown[] = [];
  const queue: IpcFrame[] = [];
  let waiter: { resolve: (frame: IpcFrame) => void; reject: (error: Error) => void } | null = null;
  let closed = false;
  let closeCount = 0;

  const deliver = (frame: IpcFrame): void => {
    if (waiter) {
      const { resolve } = waiter;
      waiter = null;
      resolve(frame);
      return;
    }
    queue.push(frame);
  };

  const disconnect = (error: Error): void => {
    if (closed) return;
    closed = true;
    if (waiter) {
      const { reject } = waiter;
      waiter = null;
      reject(error);
    }
  };

  const client: IpcClient = {
    send(frame) {
      outgoing.push(frame);
    },
    nextFrame: () => {
      const next = queue.shift();
      if (next) return Promise.resolve(next);
      if (closed) return Promise.reject(new Error("connection closed"));
      return new Promise((resolve, reject) => {
        waiter = { resolve, reject };
      });
    },
    close() {
      closeCount += 1;
      disconnect(new Error("connection closed"));
    },
  };

  return { client, outgoing, deliver, disconnect, closeCount: () => closeCount };
}

async function flush(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

const noopLocalHandler: StreamHandler = async (_streamId, _payload, _onData, onClose) => {
  onClose();
};

const STABLE_TAIL_PREDECESSOR_SOCKET_PATH = "/private/predecessor-tail.sock";

/** Routes every run to `owner` with `localHandler` (default: inert), for tests that exercise
 * forwarding rather than the local-vs-owner decision. */
function forwardingTailHandler(
  owner: ReturnType<typeof streamOwnerClient>,
  localHandler: StreamHandler = noopLocalHandler,
): StreamHandler {
  return createStableTailStreamHandler(localHandler, {
    predecessorSocketPath: STABLE_TAIL_PREDECESSOR_SOCKET_PATH,
    ownsRunLocally: () => false,
    resolvePredecessorOwner: async () => true,
    connectOwnerClient: async () => owner.client,
  });
}

describe("stable tail stream routing", () => {
  test("a run this generation owns stays local without resolving predecessor ownership", async () => {
    let refreshCalls = 0;
    const localCalls: string[] = [];
    const localHandler: StreamHandler = async (_streamId, _payload, _onData, onClose) => {
      localCalls.push("local");
      onClose();
    };
    const handler = createStableTailStreamHandler(localHandler, {
      predecessorSocketPath: STABLE_TAIL_PREDECESSOR_SOCKET_PATH,
      ownsRunLocally: () => true,
      resolvePredecessorOwner: async () => {
        refreshCalls += 1;
        return true;
      },
      connectOwnerClient: async () => {
        throw new Error("must not connect");
      },
    });

    let closed = 0;
    await handler(
      "s1",
      { runId: "run-1" },
      () => undefined,
      () => (closed += 1),
      new AbortController().signal,
    );
    expect(localCalls).toEqual(["local"]);
    expect(closed).toBe(1);
    expect(refreshCalls).toBe(0);
  });

  test("a payload without a runId stays local without resolving predecessor ownership", async () => {
    let refreshCalls = 0;
    const localCalls: string[] = [];
    const localHandler: StreamHandler = async (_streamId, _payload, _onData, onClose) => {
      localCalls.push("local");
      onClose();
    };
    const handler = createStableTailStreamHandler(localHandler, {
      predecessorSocketPath: STABLE_TAIL_PREDECESSOR_SOCKET_PATH,
      ownsRunLocally: () => false,
      resolvePredecessorOwner: async () => {
        refreshCalls += 1;
        return true;
      },
      connectOwnerClient: async () => {
        throw new Error("must not connect");
      },
    });

    let closed = 0;
    await handler(
      "s1",
      {},
      () => undefined,
      () => (closed += 1),
      new AbortController().signal,
    );
    expect(localCalls).toEqual(["local"]);
    expect(closed).toBe(1);
    expect(refreshCalls).toBe(0);
  });

  test("a run the predecessor does not own stays local", async () => {
    const localCalls: string[] = [];
    const localHandler: StreamHandler = async (_streamId, _payload, _onData, onClose) => {
      localCalls.push("local");
      onClose();
    };
    const handler = createStableTailStreamHandler(localHandler, {
      predecessorSocketPath: STABLE_TAIL_PREDECESSOR_SOCKET_PATH,
      ownsRunLocally: () => false,
      resolvePredecessorOwner: async () => false,
      connectOwnerClient: async () => {
        throw new Error("must not connect");
      },
    });

    let closed = 0;
    await handler(
      "s1",
      { runId: "run-1" },
      () => undefined,
      () => (closed += 1),
      new AbortController().signal,
    );
    expect(localCalls).toEqual(["local"]);
    expect(closed).toBe(1);
  });

  test("a run that becomes locally owned during refresh stays local despite the predecessor's claim", async () => {
    let localOwner = false;
    const localCalls: string[] = [];
    const localHandler: StreamHandler = async (_streamId, _payload, _onData, onClose) => {
      localCalls.push("local");
      onClose();
    };
    const handler = createStableTailStreamHandler(localHandler, {
      predecessorSocketPath: STABLE_TAIL_PREDECESSOR_SOCKET_PATH,
      ownsRunLocally: () => localOwner,
      resolvePredecessorOwner: async () => {
        localOwner = true;
        return true;
      },
      connectOwnerClient: async () => {
        throw new Error("must not connect");
      },
    });

    let closed = 0;
    await handler(
      "s1",
      { runId: "run-1" },
      () => undefined,
      () => (closed += 1),
      new AbortController().signal,
    );
    expect(localCalls).toEqual(["local"]);
    expect(closed).toBe(1);
  });

  test("failed ownership refresh rejects without calling onClose", async () => {
    let closed = 0;
    const handler = createStableTailStreamHandler(noopLocalHandler, {
      predecessorSocketPath: STABLE_TAIL_PREDECESSOR_SOCKET_PATH,
      ownsRunLocally: () => false,
      resolvePredecessorOwner: async () => {
        throw new Error("ownership refresh failed");
      },
      connectOwnerClient: async () => {
        throw new Error("must not connect");
      },
    });

    await expect(
      handler(
        "s1",
        { runId: "run-1" },
        () => undefined,
        () => (closed += 1),
        new AbortController().signal,
      ),
    ).rejects.toThrow("ownership refresh failed");
    expect(closed).toBe(0);
  });

  test("a failed owner connection rejects without calling onClose", async () => {
    let closed = 0;
    const handler = createStableTailStreamHandler(noopLocalHandler, {
      predecessorSocketPath: STABLE_TAIL_PREDECESSOR_SOCKET_PATH,
      ownsRunLocally: () => false,
      resolvePredecessorOwner: async () => true,
      connectOwnerClient: async () => {
        throw new Error("connect failed");
      },
    });

    await expect(
      handler(
        "s1",
        { runId: "run-1" },
        () => undefined,
        () => (closed += 1),
        new AbortController().signal,
      ),
    ).rejects.toThrow("connect failed");
    expect(closed).toBe(0);
  });

  test("forwards the original payload unchanged and relays owner records in arrival order, ending normally on owner stream-end", async () => {
    const owner = streamOwnerClient();
    const handler = forwardingTailHandler(owner);

    const onData: unknown[] = [];
    let closed = 0;
    let settled = false;
    const payload = { runId: "run-1", afterSeq: 0, follow: true };
    const pending = handler(
      "caller-stream",
      payload,
      (record) => onData.push(record),
      () => (closed += 1),
      new AbortController().signal,
    );
    void pending.finally(() => {
      settled = true;
    });

    await flush();
    expect(owner.outgoing).toHaveLength(1);
    const opened = owner.outgoing[0] as { kind: "stream-open"; streamId: string; payload: unknown };
    expect(opened.kind).toBe("stream-open");
    expect(opened.payload).toEqual(payload);

    // A stray frame for a different stream is ignored rather than crashing or delivered.
    owner.deliver({ kind: "stream-data", streamId: "unrelated-stream", payload: JSON.stringify({ seq: 99 }) });
    owner.deliver({ kind: "stream-data", streamId: opened.streamId, payload: JSON.stringify({ seq: 1 }) });
    owner.deliver({ kind: "stream-data", streamId: opened.streamId, payload: JSON.stringify({ seq: 2 }) });
    owner.deliver({ kind: "stream-end", streamId: opened.streamId });

    // Bounded microtask wait, not a real-timer sleep: a mutant that mishandles the stream-end
    // guard leaves `pending` awaiting a frame the mock owner never sends again, which hangs
    // forever rather than failing — this fails fast instead.
    await spinUntilMicrotask(() => settled, "owner stream-end settles the forwarded stream");
    await pending;
    expect(onData).toEqual([{ seq: 1 }, { seq: 2 }]);
    expect(closed).toBe(1);
    expect(owner.closeCount()).toBe(1);
  });

  test("an owner error stream-end rejects with the owner's message instead of closing successfully", async () => {
    const owner = streamOwnerClient();
    const handler = forwardingTailHandler(owner);

    let closed = 0;
    let settled = false;
    const pending = handler(
      "s1",
      { runId: "run-1" },
      () => undefined,
      () => (closed += 1),
      new AbortController().signal,
    );
    void pending
      .catch(() => undefined)
      .finally(() => {
        settled = true;
      });
    await flush();
    const opened = owner.outgoing[0] as { streamId: string };
    owner.deliver({ kind: "stream-end", streamId: opened.streamId, payload: { error: "owner read failed" } });

    // Bounded microtask wait, not a real-timer sleep: see the stream-end test above.
    await spinUntilMicrotask(() => settled, "owner error stream-end settles the forwarded stream");
    await expect(pending).rejects.toThrow("owner read failed");
    expect(closed).toBe(0);
  });

  test("owner disconnect mid-follow rejects instead of closing successfully", async () => {
    const owner = streamOwnerClient();
    const handler = forwardingTailHandler(owner);

    let closed = 0;
    const onData: unknown[] = [];
    const pending = handler(
      "s1",
      { runId: "run-1", follow: true },
      (record) => onData.push(record),
      () => (closed += 1),
      new AbortController().signal,
    );
    await flush();
    const opened = owner.outgoing[0] as { streamId: string };
    owner.deliver({ kind: "stream-data", streamId: opened.streamId, payload: JSON.stringify({ seq: 1 }) });
    await flush();
    owner.disconnect(new Error("connection closed"));

    await expect(pending).rejects.toThrow("connection closed");
    expect(onData).toEqual([{ seq: 1 }]);
    expect(closed).toBe(0);
  });

  test("caller cancellation aborts the owner connection and ends the caller stream without error", async () => {
    const owner = streamOwnerClient();
    const handler = forwardingTailHandler(owner);

    const controller = new AbortController();
    let closed = 0;
    const onData: unknown[] = [];
    const pending = handler(
      "s1",
      { runId: "run-1", follow: true },
      (record) => onData.push(record),
      () => (closed += 1),
      controller.signal,
    );
    await flush();
    expect(owner.outgoing).toHaveLength(1);

    controller.abort();
    await pending;

    expect(closed).toBe(1);
    expect(owner.closeCount()).toBe(1);
    expect(onData).toEqual([]);
  });

  test("an already-cancelled caller closes the owner connection without sending", async () => {
    const owner = streamOwnerClient();
    const handler = forwardingTailHandler(owner);

    const controller = new AbortController();
    controller.abort();
    let closed = 0;
    await handler(
      "s1",
      { runId: "run-1" },
      () => undefined,
      () => (closed += 1),
      controller.signal,
    );

    expect(owner.outgoing).toEqual([]);
    expect(closed).toBe(1);
    expect(owner.closeCount()).toBe(1);
  });
});
