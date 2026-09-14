import { isRecord } from "../../../shared/is-record.ts";
import type { IpcClient } from "../ipc/client.ts";
import { RpcError } from "../ipc/rpc-errors.ts";
import { createRpcTransport } from "../ipc/rpc-transport.ts";
import type { RpcHandler } from "../ipc/server.ts";
import type { StateStore } from "../persistence/state-store.ts";
import { mergePipelineSnapshots } from "./merge-pipeline-snapshots.ts";
import {
  PIPELINE_OWNER_RPC_TIMEOUT_MS,
  PIPELINE_UNREACHABLE_OWNER_RECOVERY,
  type PipelineListRequestParams,
  queryPipelineListsFromSocketPaths,
} from "./pipeline-daemon-resolution.ts";
import { resolvePipelineIdArgument } from "./pipeline-id-resolution.ts";
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
 * error. A predecessor with nothing listening (already exited: ENOENT/ECONNREFUSED) is not
 * degraded — local snapshots are then the complete set. Private endpoints must not use this — it would recurse when a predecessor queries its
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
      if (predecessorResult.absentSocketPaths.includes(deps.predecessorSocketPath)) {
        return { kind: "response", result: { pipelines: localSnapshots } };
      }
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

const PIPELINE_DECISION_METHODS = [
  "pipeline_approve",
  "pipeline_reject",
  "pipeline_resume",
  "pipeline_recover",
] as const;

type PipelineDecisionMethod = (typeof PIPELINE_DECISION_METHODS)[number];

type PipelineDecisionHandlers = Record<PipelineDecisionMethod, RpcHandler>;

type PipelineOwnershipStore = Pick<
  StateStore,
  | "currentOwnerIdentity"
  | "loadPipeline"
  | "listPipelines"
  | "adoptOrphanedPipeline"
  | "pipelineOwnerIsDead"
  | "claimPipelineContinuation"
>;

type PipelineDecisionRoutingDeps = {
  store: PipelineOwnershipStore;
  predecessorSocketPath: string | undefined;
  connectOwnerClient: (socketPath: string) => Promise<IpcClient>;
  /** Predecessor `pipeline_owner` confirmation query timeout; defaults to `PREDECESSOR_PIPELINE_OWNER_QUERY_TIMEOUT_MS`. */
  predecessorOwnerQueryTimeoutMs?: number;
};

// Strictly shorter than `PIPELINE_OWNER_RPC_TIMEOUT_MS`, matching the `pipeline_list` merge query's
// own headroom rationale (`PREDECESSOR_PIPELINE_LIST_TIMEOUT_MS` above), so a slow predecessor
// can't push a stable decision-verb reply past the CLI's own request timeout.
const PREDECESSOR_PIPELINE_OWNER_QUERY_TIMEOUT_MS = Math.floor(PIPELINE_OWNER_RPC_TIMEOUT_MS * 0.75);

function pipelineIdFromFrame(frame: Parameters<RpcHandler>[0]): string | undefined {
  const params = frame.params as { pipelineId?: unknown } | undefined;
  return typeof params?.pipelineId === "string" && params.pipelineId.length > 0 ? params.pipelineId : undefined;
}

/**
 * Resolves the frame's `pipelineId` argument the same way the local handler will (exact id or
 * unique prefix, `resolvePipelineIdArgument`) before the claim gate runs. An argument that doesn't
 * resolve to exactly one stored pipeline skips the claim and falls through to the local handler's
 * own unmatched/ambiguous refusal — never an unchecked action, since no pipeline row matches it.
 */
function resolvedPipelineIdFromFrame(
  frame: Parameters<RpcHandler>[0],
  store: Pick<StateStore, "loadPipeline" | "listPipelines">,
): string | undefined {
  const argument = pipelineIdFromFrame(frame);
  if (argument === undefined) return undefined;
  const resolution = resolvePipelineIdArgument(store, argument);
  return resolution.kind === "resolved" ? resolution.pipelineId : undefined;
}

function pipelineNoLiveOwnerRefusal(pipelineId: string): { kind: "error"; code: string; message: string } {
  return {
    kind: "error",
    code: "pipeline_no_live_owner",
    message: `Pipeline ${pipelineId} has no reachable live owner; ${PIPELINE_UNREACHABLE_OWNER_RECOVERY}.`,
  };
}

/** Confirms the direct predecessor still recognizes itself as owner before this generation
 * claims; returns its `ownerIdentity`, or `undefined` when unreachable or answering anything but
 * a matching `owner` witness — both refuse the claim identically, so callers don't distinguish. */
async function queryPredecessorPipelineOwner(
  pipelineId: string,
  predecessorSocketPath: string,
  deps: PipelineDecisionRoutingDeps,
): Promise<string | undefined> {
  let client: IpcClient;
  try {
    client = await deps.connectOwnerClient(predecessorSocketPath);
  } catch {
    return undefined;
  }
  const transport = createRpcTransport(client);
  try {
    const result = await transport.request(
      "pipeline_owner",
      { pipelineId },
      { timeoutMs: deps.predecessorOwnerQueryTimeoutMs ?? PREDECESSOR_PIPELINE_OWNER_QUERY_TIMEOUT_MS },
    );
    return isRecord(result) && result.kind === "owner" && typeof result.ownerIdentity === "string"
      ? result.ownerIdentity
      : undefined;
  } catch {
    return undefined;
  } finally {
    transport.close();
  }
}

/**
 * Claims a not-locally-owned pipeline before a decision verb runs its unmodified local handler:
 * this generation's own ownership, or `adoptOrphanedPipeline`'s dead-owner adoption, proceeds
 * unchanged; otherwise the direct predecessor's `pipeline_owner` must confirm it still holds the
 * row's own recorded owner identity before `claimPipelineContinuation` moves ownership here. A
 * claim lost to a concurrent claimant re-resolves once against the now-current row rather than
 * surfacing the stale read.
 */
async function claimPipelineForDecision(
  pipelineId: string,
  deps: PipelineDecisionRoutingDeps,
  alreadyRetried = false,
): Promise<{ kind: "proceed" } | { kind: "refused" }> {
  const pipeline = deps.store.loadPipeline(pipelineId);
  if (pipeline === null || pipeline.ownerIdentity === deps.store.currentOwnerIdentity()) {
    return { kind: "proceed" };
  }
  if (await deps.store.adoptOrphanedPipeline(pipelineId)) {
    return { kind: "proceed" };
  }
  // An `interrupted` pipeline (never adopted above) whose recorded owner is dead has no driver to
  // hand off from: the local handler's own continuation claim takes it from the dead owner.
  if (pipeline.status === "interrupted" && (await deps.store.pipelineOwnerIsDead(pipelineId))) {
    return { kind: "proceed" };
  }
  const { predecessorSocketPath } = deps;
  if (predecessorSocketPath === undefined) {
    return { kind: "refused" };
  }
  const predecessorOwnerIdentity = await queryPredecessorPipelineOwner(pipelineId, predecessorSocketPath, deps);
  if (predecessorOwnerIdentity !== pipeline.ownerIdentity) {
    return { kind: "refused" };
  }
  const claim = deps.store.claimPipelineContinuation({ pipelineId, priorOwnerIdentity: pipeline.ownerIdentity });
  if (claim.kind === "applied") {
    return { kind: "proceed" };
  }
  if (alreadyRetried) {
    return { kind: "refused" };
  }
  return claimPipelineForDecision(pipelineId, deps, true);
}

/**
 * Wraps the four pipeline decision verbs on the stable endpoint only: a not-locally-owned
 * pipeline is durably claimed from its live, draining direct predecessor (see
 * `claimPipelineForDecision`) before the existing unmodified local handler runs, so any successor
 * stage the decision unblocks is admitted by this generation's own `pipelineExecutionDeps()`. The
 * predecessor's own handlers are never invoked — private endpoints keep the unwrapped handlers.
 */
export function createStablePipelineDecisionHandlers(
  localHandlers: PipelineDecisionHandlers,
  deps: PipelineDecisionRoutingDeps,
): PipelineDecisionHandlers {
  const routed = {} as PipelineDecisionHandlers;
  for (const method of PIPELINE_DECISION_METHODS) {
    routed[method] = async (frame, signal) => {
      const pipelineId = resolvedPipelineIdFromFrame(frame, deps.store);
      if (pipelineId === undefined) return localHandlers[method](frame, signal);
      const claim = await claimPipelineForDecision(pipelineId, deps);
      if (claim.kind === "refused") return pipelineNoLiveOwnerRefusal(pipelineId);
      return localHandlers[method](frame, signal);
    };
  }
  return routed;
}
