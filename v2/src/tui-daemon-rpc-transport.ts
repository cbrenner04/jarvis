import type { IpcClient } from "./ipc/client.ts";
import type { ErrorFrame, IpcFrame, ResponseFrame } from "./ipc/types.ts";
import { TuiDaemonConnectionError, TuiDaemonRpcError } from "./tui-daemon-errors.ts";

type PendingRpc = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

export type TuiDaemonRpcTransport = {
  request(method: string, params?: unknown, options?: { trackWait?: boolean }): Promise<unknown>;
  close(): void;
};

function isCorrelatedRpcFrame(frame: IpcFrame): frame is ResponseFrame | ErrorFrame {
  return (frame.kind === "response" || frame.kind === "error") && typeof frame.id === "string";
}

/** Multiplex correlated IPC requests on one transport; abandons prior `wait` when a new one starts. */
export function createTuiDaemonRpcTransport(client: IpcClient): TuiDaemonRpcTransport {
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
    rejectAll(new TuiDaemonConnectionError(message));
  };

  const ensureReader = (): void => {
    if (readerStarted) return;
    readerStarted = true;
    void (async () => {
      while (!closed) {
        let frame: IpcFrame;
        try {
          frame = await client.nextFrame();
        } catch (cause) {
          if (!closed) rejectAll(new TuiDaemonConnectionError("IPC connection lost", { cause }));
          return;
        }

        if (frame.kind !== "response" && frame.kind !== "error") {
          failProtocol(`malformed RPC reply: unexpected frame kind ${frame.kind}`);
          return;
        }
        if (!isCorrelatedRpcFrame(frame)) {
          failProtocol("malformed RPC reply: missing correlation id");
          return;
        }

        const entry = pending.get(frame.id);
        if (!entry) {
          if (abandoned.delete(frame.id)) continue;
          failProtocol("non-correlated RPC reply");
          return;
        }

        pending.delete(frame.id);
        if (frame.kind === "error") {
          entry.reject(new TuiDaemonRpcError(frame.code, frame.message));
          continue;
        }
        entry.resolve(frame.result);
      }
    })();
  };

  return {
    request(method, params, options) {
      if (closed) return Promise.reject(new TuiDaemonConnectionError("IPC connection lost"));
      if (options?.trackWait && activeWaitId !== null) abandonRequest(activeWaitId);

      const id = crypto.randomUUID();
      if (options?.trackWait) activeWaitId = id;

      return new Promise<unknown>((resolve, reject) => {
        pending.set(id, {
          resolve: (result) => {
            if (activeWaitId === id) activeWaitId = null;
            resolve(result);
          },
          reject: (error) => {
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
          reject(new TuiDaemonConnectionError("IPC connection lost", { cause }));
        }
      });
    },
    close() {
      if (closed) return;
      client.close();
      rejectAll(new TuiDaemonConnectionError("IPC connection lost"));
    },
  };
}
