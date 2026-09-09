import type { CliDeps } from "../cli/deps.ts";
import type { IpcClient } from "../ipc/client.ts";
import { createRpcTransport } from "../ipc/rpc-transport.ts";
import type { PipelineDerivedState } from "./pipeline-execution.ts";
import { type QueryDaemonListsDeps, resolveDaemonListSocketPaths } from "./query-daemon-lists-from-sockets.ts";

const PIPELINE_OWNER_RPC_TIMEOUT_MS = 2_000;

export const PIPELINE_NO_LIVE_OWNER_RECOVERY = "jarvis daemon start, then retry";

type PipelineOwnerWitness =
  | { kind: "owner"; pipelineId: string }
  | { kind: "not_owner"; pipelineId: string }
  | { kind: "durable_state"; pipelineId: string; state: PipelineDerivedState }
  | { kind: "not_found"; pipelineId: string };

export type PipelineDaemonResolution =
  | { kind: "owner"; pipelineId: string; socketPath: string }
  | { kind: "durable_state"; pipelineId: string; socketPath: string; state: PipelineDerivedState }
  | { kind: "pipeline_owner_conflict"; pipelineId: string; claimantPaths: string[] }
  | { kind: "pipeline_no_live_owner"; pipelineId: string; recovery: typeof PIPELINE_NO_LIVE_OWNER_RECOVERY }
  | { kind: "pipeline_not_found"; pipelineId: string }
  | { kind: "pipeline_daemon_unavailable"; pipelineId: string };

export type PipelineDaemonResolutionDeps = QueryDaemonListsDeps & Pick<CliDeps, "startDaemon">;

const PIPELINE_STATES: ReadonlySet<string> = new Set([
  "succeeded",
  "failed",
  "rejected",
  "interrupted",
  "awaiting-approval",
  "running",
  "pending",
]);

function parsePipelineOwnerWitness(value: unknown, pipelineId: string): PipelineOwnerWitness | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const response = value as { kind?: unknown; pipelineId?: unknown; state?: unknown };
  if (response.pipelineId !== pipelineId) return undefined;
  switch (response.kind) {
    case "owner":
    case "not_owner":
    case "not_found":
      return { kind: response.kind, pipelineId };
    case "durable_state":
      return typeof response.state === "string" && PIPELINE_STATES.has(response.state)
        ? { kind: "durable_state", pipelineId, state: response.state as PipelineDerivedState }
        : undefined;
    default:
      return undefined;
  }
}

function connectWithinTimeout(
  connectIpcClient: (socketPath: string) => Promise<IpcClient>,
  socketPath: string,
  timeoutMs: number,
): Promise<IpcClient> {
  return new Promise((resolve, reject) => {
    let pending = true;
    const timer = setTimeout(() => {
      pending = false;
      reject(new Error("pipeline daemon connection timed out"));
    }, timeoutMs);
    void connectIpcClient(socketPath).then(
      (client) => {
        if (!pending) {
          client.close();
          return;
        }
        pending = false;
        clearTimeout(timer);
        resolve(client);
      },
      (error: unknown) => {
        pending = false;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function queryPipelineOwner(
  connectIpcClient: (socketPath: string) => Promise<IpcClient>,
  socketPath: string,
  pipelineId: string,
  timeoutMs: number,
): Promise<PipelineOwnerWitness | undefined> {
  let client: IpcClient | undefined;
  try {
    client = await connectWithinTimeout(connectIpcClient, socketPath, timeoutMs);
    const transport = createRpcTransport(client);
    try {
      const result = await transport.request("pipeline_owner", { pipelineId }, { timeoutMs });
      return parsePipelineOwnerWitness(result, pipelineId);
    } finally {
      transport.close();
    }
  } catch {
    client?.close();
    return undefined;
  }
}

/** Queries every supplied socket; individual connection, RPC, timeout, and payload failures are ignored. */
export async function resolvePipelineDaemonFromSocketPaths(
  connectIpcClient: (socketPath: string) => Promise<IpcClient>,
  socketPaths: readonly string[],
  pipelineId: string,
  timeoutMs = PIPELINE_OWNER_RPC_TIMEOUT_MS,
): Promise<PipelineDaemonResolution> {
  const answers = await Promise.all(
    socketPaths.map(async (socketPath) => ({
      socketPath,
      witness: await queryPipelineOwner(connectIpcClient, socketPath, pipelineId, timeoutMs),
    })),
  );
  const owners = answers.filter(
    (answer): answer is { socketPath: string; witness: Extract<PipelineOwnerWitness, { kind: "owner" }> } =>
      answer.witness?.kind === "owner",
  );
  if (owners.length > 1) {
    return {
      kind: "pipeline_owner_conflict",
      pipelineId,
      claimantPaths: owners.map(({ socketPath }) => socketPath).sort(),
    };
  }
  const owner = owners[0];
  if (owner !== undefined) return { kind: "owner", pipelineId, socketPath: owner.socketPath };

  const durable = answers
    .filter(
      (
        answer,
      ): answer is {
        socketPath: string;
        witness: Extract<PipelineOwnerWitness, { kind: "durable_state" }>;
      } => answer.witness?.kind === "durable_state",
    )
    .sort((left, right) => left.socketPath.localeCompare(right.socketPath))[0];
  if (durable !== undefined) {
    return {
      kind: "durable_state",
      pipelineId,
      socketPath: durable.socketPath,
      state: durable.witness.state,
    };
  }
  if (answers.some(({ witness }) => witness?.kind === "not_owner")) {
    return { kind: "pipeline_no_live_owner", pipelineId, recovery: PIPELINE_NO_LIVE_OWNER_RECOVERY };
  }
  if (answers.some(({ witness }) => witness?.kind === "not_found")) {
    return { kind: "pipeline_not_found", pipelineId };
  }
  return { kind: "pipeline_daemon_unavailable", pipelineId };
}

/** Resolves a full pipeline id across the same discovered-plus-invoking socket set used by run listing. */
export async function resolvePipelineDaemon(
  pipelineId: string,
  deps: PipelineDaemonResolutionDeps,
  timeoutMs = PIPELINE_OWNER_RPC_TIMEOUT_MS,
): Promise<PipelineDaemonResolution> {
  const socketPaths = await resolveDaemonListSocketPaths(deps);
  return resolvePipelineDaemonFromSocketPaths(deps.connectIpcClient, socketPaths, pipelineId, timeoutMs);
}
