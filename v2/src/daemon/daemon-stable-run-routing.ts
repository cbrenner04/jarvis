import type { IpcClient } from "../ipc/client.ts";
import { RpcError } from "../ipc/rpc-errors.ts";
import { createRpcTransport } from "../ipc/rpc-transport.ts";
import type { RpcHandler } from "../ipc/server.ts";
import { mergePipelineSnapshots } from "./merge-pipeline-snapshots.ts";
import {
  PIPELINE_OWNER_RPC_TIMEOUT_MS,
  type PipelineListRequestParams,
  queryPipelineListsFromSocketPaths,
} from "./pipeline-daemon-resolution.ts";
import type { PipelineSnapshot } from "./pipeline-observation.ts";

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

// Strictly shorter than PIPELINE_OWNER_RPC_TIMEOUT_MS, leaving headroom for local processing so a
// slow predecessor can't push the stable `pipeline_list` reply past the CLI's own request timeout.
const PREDECESSOR_PIPELINE_LIST_TIMEOUT_MS = Math.floor(PIPELINE_OWNER_RPC_TIMEOUT_MS * 0.75);

type StablePipelineListDeps = {
  predecessorSocketPath: string;
  connectOwnerClient: (socketPath: string) => Promise<IpcClient>;
  /** Predecessor query timeout; defaults to `PREDECESSOR_PIPELINE_LIST_TIMEOUT_MS`. */
  predecessorQueryTimeoutMs?: number;
};

/**
 * Wraps the stable-address `pipeline_list` handler to merge in the direct predecessor's
 * pipelines. Keyed under fixed synthetic labels `"local"`/`"predecessor"` so a same-id collision
 * keeps the local snapshot deterministically (`"local"` sorts first). An unreachable, timed-out,
 * or malformed predecessor answer yields local-only snapshots with `degraded: true`, never an
 * error. Private endpoints must not use this — it would recurse when a predecessor queries its
 * own successor's private endpoint.
 */
export function createStablePipelineListHandler(localHandler: RpcHandler, deps: StablePipelineListDeps): RpcHandler {
  return async (frame, signal) => {
    const localReply = await localHandler(frame, signal);
    if (localReply.kind !== "response") return localReply;
    const localSnapshots = (localReply.result as { pipelines: readonly PipelineSnapshot[] }).pipelines;
    const params = frame.params as PipelineListRequestParams | undefined;
    const predecessorResult = await queryPipelineListsFromSocketPaths(
      deps.connectOwnerClient,
      [deps.predecessorSocketPath],
      params,
      deps.predecessorQueryTimeoutMs ?? PREDECESSOR_PIPELINE_LIST_TIMEOUT_MS,
    );
    const predecessorSnapshots = predecessorResult.snapshotsBySocketPath[deps.predecessorSocketPath];
    if (predecessorSnapshots === undefined) {
      return { kind: "response", result: { pipelines: localSnapshots, degraded: true } };
    }
    const merged = mergePipelineSnapshots({ local: localSnapshots, predecessor: predecessorSnapshots });
    return { kind: "response", result: { pipelines: merged } };
  };
}

/** Wraps only stable-address live-run unary handlers; private endpoints keep the local handlers. */
export function createStableRunHandlers(
  localHandlers: DirectOwnerRunHandlers,
  deps: DirectOwnerRunRoutingDeps,
): DirectOwnerRunHandlers {
  // A route-loss ownership lookup (poll failure — the owner route itself, not a definitive
  // "unowned" answer) falls back to local handling, same as `createStableAdmissionHandlers`'s
  // `ownedOrLocal`: never leaves the run unreachable via both the owner route and local control.
  const ownedOrLocal = (lookup: () => Promise<boolean>): Promise<boolean> => lookup().catch(() => false);
  const routed = {} as DirectOwnerRunHandlers;
  for (const method of DIRECT_OWNER_RUN_METHODS) {
    routed[method] = async (frame, signal) => {
      const runId = runIdFromFrame(frame);
      if (runId === undefined || deps.ownsRunLocally(runId)) return localHandlers[method](frame, signal);
      const predecessorOwnsRun = await ownedOrLocal(() => deps.resolvePredecessorOwner(runId));
      if (deps.ownsRunLocally(runId) || !predecessorOwnsRun) return localHandlers[method](frame, signal);
      return forwardToDirectOwner(method, frame.params, signal, deps);
    };
  }
  return routed;
}
