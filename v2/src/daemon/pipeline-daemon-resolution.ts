import { isRecord } from "../../../shared/is-record.ts";
import type { IpcClient } from "../ipc/client.ts";
import { createRpcTransport } from "../ipc/rpc-transport.ts";
import type { startDaemon } from "./daemon-lifecycle.ts";
import { mergePipelineSnapshots } from "./merge-pipeline-snapshots.ts";
import type { PipelineDerivedState } from "./pipeline-execution.ts";
import { ambiguousPipelineIdMessage, PIPELINE_ID_PREFIX_MIN_LENGTH } from "./pipeline-id-resolution.ts";
import type { PipelineSnapshot } from "./pipeline-observation.ts";
import { type QueryDaemonListsDeps, resolveDaemonListSocketPaths } from "./query-daemon-lists-from-sockets.ts";

const PIPELINE_OWNER_RPC_TIMEOUT_MS = 2_000;

export const PIPELINE_NO_LIVE_OWNER_RECOVERY = "jarvis daemon start, then retry";

type PipelineOwnerWitness =
  | { kind: "owner" }
  | { kind: "not_owner" }
  | { kind: "durable_state"; state: PipelineDerivedState }
  | { kind: "not_found" };

export type PipelineListQueryResult = {
  snapshotsBySocketPath: Readonly<Record<string, readonly PipelineSnapshot[]>>;
  hasMalformedResponse: boolean;
};

export type PipelineDaemonResolution =
  | { kind: "owner"; pipelineId: string; socketPath: string }
  | { kind: "durable_state"; pipelineId: string; socketPath: string; state: PipelineDerivedState }
  | { kind: "pipeline_owner_conflict"; pipelineId: string; claimantPaths: string[] }
  | { kind: "pipeline_no_live_owner"; pipelineId: string; recovery: typeof PIPELINE_NO_LIVE_OWNER_RECOVERY }
  | { kind: "pipeline_not_found"; pipelineId: string }
  | { kind: "pipeline_daemon_unavailable"; pipelineId: string };

export type PipelineDaemonResolutionDeps = QueryDaemonListsDeps & {
  /** Never invoked by resolution; exposed only so callers/tests can assert it stays untouched. */
  startDaemon: typeof startDaemon;
};

const PIPELINE_STATE_KEYS = {
  succeeded: true,
  failed: true,
  rejected: true,
  interrupted: true,
  "awaiting-approval": true,
  running: true,
  pending: true,
} satisfies Record<PipelineDerivedState, true>;

const PIPELINE_STATES: ReadonlySet<string> = new Set(Object.keys(PIPELINE_STATE_KEYS));

const PIPELINE_TERMINAL_ACTIONS: ReadonlySet<string> = new Set(["leave-draft", "ready", "merge"]);

function parsePipelineOwnerWitness(value: unknown, pipelineId: string): PipelineOwnerWitness | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const response = value as { kind?: unknown; pipelineId?: unknown; state?: unknown };
  if (response.pipelineId !== pipelineId) return undefined;
  switch (response.kind) {
    case "owner":
    case "not_owner":
    case "not_found":
      return { kind: response.kind };
    case "durable_state":
      return typeof response.state === "string" && PIPELINE_STATES.has(response.state)
        ? { kind: "durable_state", state: response.state as PipelineDerivedState }
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
  try {
    const client = await connectWithinTimeout(connectIpcClient, socketPath, timeoutMs);
    const transport = createRpcTransport(client);
    try {
      const result = await transport.request("pipeline_owner", { pipelineId }, { timeoutMs });
      return parsePipelineOwnerWitness(result, pipelineId);
    } finally {
      transport.close();
    }
  } catch {
    return undefined;
  }
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isPublicationFailure(value: unknown): boolean {
  if (!isRecord(value) || typeof value.operation !== "string" || typeof value.message !== "string") return false;
  return (
    (value.exitCode === undefined || (typeof value.exitCode === "number" && Number.isFinite(value.exitCode))) &&
    isOptionalString(value.stdoutTail) &&
    isOptionalString(value.stderrTail)
  );
}

function isTerminalPublicationFailure(value: unknown): boolean {
  if (value === null) return true;
  if (
    !isRecord(value) ||
    typeof value.terminalAction !== "string" ||
    !PIPELINE_TERMINAL_ACTIONS.has(value.terminalAction)
  ) {
    return false;
  }
  return (
    isPublicationFailure(value.failure) &&
    (value.prNumber === undefined || typeof value.prNumber === "number") &&
    isOptionalString(value.prUrl)
  );
}

function isPipelineStageSnapshot(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.stageId === "string" &&
    typeof value.branchKey === "string" &&
    typeof value.position === "number" &&
    Number.isFinite(value.position) &&
    typeof value.status === "string" &&
    (value.workflowInvocationId === null || typeof value.workflowInvocationId === "string") &&
    isNullableNumber(value.startedAt) &&
    isNullableNumber(value.endedAt) &&
    isNullableNumber(value.decidedAt) &&
    Object.hasOwn(value, "artifact") &&
    Object.hasOwn(value, "failureDetail")
  );
}

function isPipelineSnapshot(value: unknown): value is PipelineSnapshot {
  if (!isRecord(value)) return false;
  return (
    typeof value.pipelineId === "string" &&
    typeof value.name === "string" &&
    typeof value.state === "string" &&
    PIPELINE_STATES.has(value.state) &&
    (value.terminalAction === undefined ||
      (typeof value.terminalAction === "string" && PIPELINE_TERMINAL_ACTIONS.has(value.terminalAction))) &&
    isOptionalString(value.seedPath) &&
    isNullableNumber(value.terminalPublicationSucceededAt) &&
    isTerminalPublicationFailure(value.terminalPublicationFailure) &&
    typeof value.createdAt === "number" &&
    Number.isFinite(value.createdAt) &&
    isNullableNumber(value.finishedAtMs) &&
    isNullableNumber(value.dismissedAt) &&
    Array.isArray(value.stages) &&
    value.stages.every(isPipelineStageSnapshot)
  );
}

function parsePipelineList(value: unknown): readonly PipelineSnapshot[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.pipelines) || !value.pipelines.every(isPipelineSnapshot))
    return undefined;
  return value.pipelines;
}

async function queryPipelineList(
  connectIpcClient: (socketPath: string) => Promise<IpcClient>,
  socketPath: string,
  params: PipelineListRequestParams | undefined,
  timeoutMs: number,
): Promise<{ snapshots?: readonly PipelineSnapshot[]; malformed: boolean }> {
  try {
    const client = await connectWithinTimeout(connectIpcClient, socketPath, timeoutMs);
    const transport = createRpcTransport(client);
    try {
      const snapshots = parsePipelineList(await transport.request("pipeline_list", params, { timeoutMs }));
      return snapshots === undefined ? { malformed: true } : { snapshots, malformed: false };
    } catch {
      return { malformed: false };
    } finally {
      transport.close();
    }
  } catch {
    return { malformed: false };
  }
}

/** Queries every supplied socket without starting a daemon; individual connection, RPC, and timeout failures are skipped. */
/** `pipeline_list` request params: dismissal visibility plus the filtered-bypass filters. */
export type PipelineListRequestParams = {
  includeDismissed?: true;
  sinceMs?: number;
  state?: PipelineDerivedState;
};

export async function queryPipelineListsFromSocketPaths(
  connectIpcClient: (socketPath: string) => Promise<IpcClient>,
  socketPaths: readonly string[],
  params: PipelineListRequestParams | undefined,
  timeoutMs = PIPELINE_OWNER_RPC_TIMEOUT_MS,
): Promise<PipelineListQueryResult> {
  const answers = await Promise.all(
    socketPaths.map(async (socketPath) => ({
      socketPath,
      ...(await queryPipelineList(connectIpcClient, socketPath, params, timeoutMs)),
    })),
  );
  return {
    snapshotsBySocketPath: Object.fromEntries(
      answers.flatMap(({ socketPath, snapshots }) => (snapshots === undefined ? [] : [[socketPath, snapshots]])),
    ),
    hasMalformedResponse: answers.some(({ malformed }) => malformed),
  };
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

  const durableAnswers = answers.filter(
    (
      answer,
    ): answer is {
      socketPath: string;
      witness: Extract<PipelineOwnerWitness, { kind: "durable_state" }>;
    } => answer.witness?.kind === "durable_state",
  );
  const durableSocketPath = durableAnswers.map(({ socketPath }) => socketPath).sort()[0];
  const durable = durableAnswers.find((answer) => answer.socketPath === durableSocketPath);
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

type PipelineIdCrossDaemonResolution =
  | { kind: "resolved"; pipelineId: string }
  | { kind: "ambiguous"; candidates: string[]; message: string }
  | { kind: "incomplete"; message: string }
  /** Nothing matched; the caller keeps its own not-found handling for the argument as given. */
  | { kind: "unmatched"; pipelineId: string };

/**
 * Resolves a CLI pipeline id argument (exact id or unique ≥8-char prefix, dismissed pipelines
 * included) against the merged listing across every live discovered-plus-invoking socket, the
 * same set `pipeline list` queries. Never starts a daemon.
 */
export async function resolvePipelineIdAcrossDaemons(
  argument: string,
  deps: QueryDaemonListsDeps,
  timeoutMs = PIPELINE_OWNER_RPC_TIMEOUT_MS,
): Promise<PipelineIdCrossDaemonResolution> {
  const socketPaths = await resolveDaemonListSocketPaths(deps);
  const queryResult = await queryPipelineListsFromSocketPaths(
    deps.connectIpcClient,
    socketPaths,
    // sinceMs: 0 takes the daemon's filtered bypass so the terminal-retention cap cannot evict a
    // pipeline out of the candidate id set; a prefix the operator read from an earlier listing must
    // keep resolving.
    { includeDismissed: true, sinceMs: 0 },
    timeoutMs,
  );
  const ids = mergePipelineSnapshots(queryResult.snapshotsBySocketPath).map((snapshot) => snapshot.pipelineId);
  if (ids.includes(argument)) return { kind: "resolved", pipelineId: argument };
  if (argument.length < PIPELINE_ID_PREFIX_MIN_LENGTH) return { kind: "unmatched", pipelineId: argument };
  if (queryResult.hasMalformedResponse || socketPaths.some((path) => !(path in queryResult.snapshotsBySocketPath))) {
    return {
      kind: "incomplete",
      message: `pipeline_id_set_incomplete: Cannot resolve prefix ${argument}: a daemon listing was malformed or unavailable; restore daemon connectivity or use a known full pipeline id.`,
    };
  }
  const candidates = ids.filter((id) => id.startsWith(argument)).sort();
  const [only] = candidates;
  if (candidates.length === 1 && only !== undefined) return { kind: "resolved", pipelineId: only };
  if (candidates.length > 1) {
    return { kind: "ambiguous", candidates, message: ambiguousPipelineIdMessage(argument, candidates) };
  }
  return { kind: "unmatched", pipelineId: argument };
}
