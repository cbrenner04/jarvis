import type { IpcClient } from "./client.ts";
import { RpcConnectionError, RpcError } from "./rpc-errors.ts";
import type { ErrorFrame, IpcFrame, ResponseFrame } from "./types.ts";

type PendingRpc = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

type RpcTransport = {
  request(method: string, params?: unknown, options?: { trackWait?: boolean; timeoutMs?: number }): Promise<unknown>;
  close(): void;
};

function isCorrelatedRpcFrame(frame: IpcFrame): frame is ResponseFrame | ErrorFrame {
  return (frame.kind === "response" || frame.kind === "error") && typeof frame.id === "string";
}

async function nextRpcFrame(
  client: IpcClient,
  isClosed: () => boolean,
  rejectAll: (error: Error) => void,
): Promise<IpcFrame | undefined> {
  try {
    return await client.nextFrame();
  } catch (cause) {
    if (!isClosed()) rejectAll(new RpcConnectionError("IPC connection lost", { cause }));
    return undefined;
  }
}

function handleRpcFrame(
  frame: IpcFrame,
  pending: Map<string, PendingRpc>,
  abandoned: Set<string>,
): { kind: "continue" } | { kind: "protocol-error"; message: string } {
  if (frame.kind !== "response" && frame.kind !== "error") {
    return { kind: "protocol-error", message: `malformed RPC reply: unexpected frame kind ${frame.kind}` };
  }
  if (!isCorrelatedRpcFrame(frame)) {
    return { kind: "protocol-error", message: "malformed RPC reply: missing correlation id" };
  }

  const entry = pending.get(frame.id);
  if (!entry) {
    if (abandoned.delete(frame.id)) return { kind: "continue" };
    return { kind: "protocol-error", message: "non-correlated RPC reply" };
  }

  pending.delete(frame.id);
  if (frame.kind === "error") {
    entry.reject(new RpcError(frame.code, frame.message));
    return { kind: "continue" };
  }

  entry.resolve(frame.result);
  return { kind: "continue" };
}

async function readRpcFrames(
  client: IpcClient,
  isClosed: () => boolean,
  rejectAll: (error: Error) => void,
  failProtocol: (message: string) => void,
  pending: Map<string, PendingRpc>,
  abandoned: Set<string>,
): Promise<void> {
  while (!isClosed()) {
    const frame = await nextRpcFrame(client, isClosed, rejectAll);
    if (frame === undefined) return;

    const handling = handleRpcFrame(frame, pending, abandoned);
    if (handling.kind === "continue") continue;
    failProtocol(handling.message);
    return;
  }
}

/** Multiplex correlated IPC requests on one transport; abandons prior `wait` when a new one starts. */
export function createRpcTransport(client: IpcClient): RpcTransport {
  const pending = new Map<string, PendingRpc>();
  const abandoned = new Set<string>();
  let activeWaitId: string | null = null;
  let closed = false;
  let readerStarted = false;

  const abandonRequest = (id: string): void => {
    abandoned.add(id);
    pending.delete(id);
    if (activeWaitId === id) activeWaitId = null;
  };

  const rejectAll = (error: Error): void => {
    closed = true;
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
    abandoned.clear();
  };

  const failProtocol = (message: string): void => {
    client.close();
    rejectAll(new RpcConnectionError(message));
  };

  const ensureReader = (): void => {
    if (readerStarted) return;
    readerStarted = true;
    void readRpcFrames(client, () => closed, rejectAll, failProtocol, pending, abandoned);
  };

  return {
    request(method, params, options) {
      if (closed) return Promise.reject(new RpcConnectionError("IPC connection lost"));
      if (options?.trackWait && activeWaitId !== null) abandonRequest(activeWaitId);

      const id = crypto.randomUUID();
      if (options?.trackWait) activeWaitId = id;

      return new Promise<unknown>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const clearTimer = (): void => {
          if (timer !== undefined) clearTimeout(timer);
        };

        pending.set(id, {
          resolve: (result) => {
            clearTimer();
            if (activeWaitId === id) activeWaitId = null;
            resolve(result);
          },
          reject: (error) => {
            clearTimer();
            if (activeWaitId === id) activeWaitId = null;
            reject(error);
          },
        });
        ensureReader();
        try {
          client.send({ kind: "request", id, method, ...(params !== undefined ? { params } : {}) });
        } catch (cause) {
          pending.delete(id);
          abandoned.delete(id);
          if (activeWaitId === id) activeWaitId = null;
          reject(new RpcConnectionError("IPC connection lost", { cause }));
          return;
        }

        if (options?.timeoutMs !== undefined) {
          timer = setTimeout(() => {
            if (!pending.has(id)) return;
            abandonRequest(id);
            reject(new RpcConnectionError(`RPC request timed out after ${options.timeoutMs}ms`));
          }, options.timeoutMs);
        }
      });
    },
    close() {
      if (closed) return;
      client.close();
      rejectAll(new RpcConnectionError("IPC connection lost"));
    },
  };
}
