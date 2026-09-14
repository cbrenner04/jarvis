import type { IpcClient } from "../ipc/client.ts";
import { parseStreamPayload } from "../ipc/codec.ts";
import { RpcError } from "../ipc/rpc-errors.ts";
import { createRpcTransport } from "../ipc/rpc-transport.ts";
import type { RpcHandler, StreamHandler } from "../ipc/server.ts";
import type { IpcFrame } from "../ipc/types.ts";
import { parseTailStreamParams } from "./daemon-tail-stream.ts";

const DIRECT_OWNER_RUN_METHODS = ["wait", "pause", "kill"] as const;

type DirectOwnerRunMethod = (typeof DIRECT_OWNER_RUN_METHODS)[number];

type DirectOwnerRunHandlers = Record<DirectOwnerRunMethod, RpcHandler>;

type DirectOwnerRunRoutingDeps = {
  predecessorSocketPath: string;
  ownsRunLocally: (runId: string) => boolean;
  resolvePredecessorOwner: (runId: string) => Promise<boolean>;
  connectOwnerClient: (socketPath: string) => Promise<IpcClient>;
};

function runIdFromFrame(frame: Parameters<RpcHandler>[0]): string | undefined {
  const params = frame.params as { runId?: unknown } | undefined;
  return typeof params?.runId === "string" && params.runId.length > 0 ? params.runId : undefined;
}

async function forwardToDirectOwner(
  method: DirectOwnerRunMethod,
  params: unknown,
  signal: AbortSignal,
  deps: DirectOwnerRunRoutingDeps,
): Promise<Awaited<ReturnType<RpcHandler>>> {
  const client = await deps.connectOwnerClient(deps.predecessorSocketPath);
  const transport = createRpcTransport(client);
  const close = (): void => transport.close();
  signal.addEventListener("abort", close, { once: true });
  try {
    if (signal.aborted) throw new Error("request aborted");
    const result = await transport.request(method, params);
    return { kind: "response", result };
  } catch (error) {
    if (error instanceof RpcError) {
      return { kind: "error", code: error.code, message: error.message };
    }
    throw error;
  } finally {
    signal.removeEventListener("abort", close);
    transport.close();
  }
}

function ownerStreamEndErrorMessage(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const error = (payload as { error?: unknown }).error;
  return typeof error === "string" ? error : undefined;
}

/** Opens one owner stream, forwards the original params unchanged, and relays each owner
 * `stream-data` record to `onData` in arrival order. A caller abort closes the owner connection;
 * an owner error `stream-end` or unexpected disconnect rejects instead of calling `onClose`, so the
 * caller always gets an error end, never a masked success. */
async function forwardStreamToDirectOwner(
  payload: unknown,
  onData: (record: unknown) => void,
  onClose: () => void,
  signal: AbortSignal,
  deps: DirectOwnerRunRoutingDeps,
): Promise<void> {
  const client = await deps.connectOwnerClient(deps.predecessorSocketPath);
  const ownerStreamId = crypto.randomUUID();
  let closed = false;
  const closeClient = (): void => {
    if (closed) return;
    closed = true;
    client.close();
  };
  signal.addEventListener("abort", closeClient, { once: true });
  try {
    if (signal.aborted) {
      onClose();
      return;
    }
    client.send({ kind: "stream-open", streamId: ownerStreamId, payload });
    while (true) {
      let frame: IpcFrame;
      try {
        frame = await client.nextFrame();
      } catch (error) {
        if (signal.aborted) {
          onClose();
          return;
        }
        throw error;
      }
      if (frame.kind === "stream-data" && frame.streamId === ownerStreamId) {
        onData(parseStreamPayload(frame.payload));
        continue;
      }
      if (frame.kind === "stream-end" && frame.streamId === ownerStreamId) {
        const errorMessage = ownerStreamEndErrorMessage(frame.payload);
        if (errorMessage !== undefined) throw new Error(errorMessage);
        onClose();
        return;
      }
    }
  } finally {
    signal.removeEventListener("abort", closeClient);
    closeClient();
  }
}

/** Wraps only the stable-address tail stream handler with the same direct-owner ownership check
 * as `createStableRunHandlers`; private endpoints keep the local handler. */
export function createStableTailStreamHandler(
  localHandler: StreamHandler,
  deps: DirectOwnerRunRoutingDeps,
): StreamHandler {
  return async (streamId, payload, onData, onClose, signal) => {
    const runId = parseTailStreamParams(payload)?.runId;
    if (runId === undefined || deps.ownsRunLocally(runId)) {
      return localHandler(streamId, payload, onData, onClose, signal);
    }
    const predecessorOwnsRun = await deps.resolvePredecessorOwner(runId);
    if (deps.ownsRunLocally(runId) || !predecessorOwnsRun) {
      return localHandler(streamId, payload, onData, onClose, signal);
    }
    return forwardStreamToDirectOwner(payload, onData, onClose, signal, deps);
  };
}

/** Wraps only stable-address live-run unary handlers; private endpoints keep the local handlers. */
export function createStableRunHandlers(
  localHandlers: DirectOwnerRunHandlers,
  deps: DirectOwnerRunRoutingDeps,
): DirectOwnerRunHandlers {
  const routed = {} as DirectOwnerRunHandlers;
  for (const method of DIRECT_OWNER_RUN_METHODS) {
    routed[method] = async (frame, signal) => {
      const runId = runIdFromFrame(frame);
      if (runId === undefined || deps.ownsRunLocally(runId)) return localHandlers[method](frame, signal);
      const predecessorOwnsRun = await deps.resolvePredecessorOwner(runId);
      if (deps.ownsRunLocally(runId) || !predecessorOwnsRun) return localHandlers[method](frame, signal);
      return forwardToDirectOwner(method, frame.params, signal, deps);
    };
  }
  return routed;
}
