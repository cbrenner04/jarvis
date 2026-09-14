import type { IpcClient } from "../ipc/client.ts";
import { RpcError } from "../ipc/rpc-errors.ts";
import { createRpcTransport } from "../ipc/rpc-transport.ts";
import type { RpcHandler } from "../ipc/server.ts";

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
