import { isRecord } from "../../../shared/is-record.ts";
import type { CliDeps } from "../cli/deps.ts";
import type { IpcClient } from "../ipc/client.ts";
import { createRpcTransport } from "../ipc/rpc-transport.ts";
import type { PipelineDerivedState } from "./pipeline-execution.ts";
import { ambiguousPipelineIdMessage, PIPELINE_ID_PREFIX_MIN_LENGTH } from "./pipeline-id-resolution.ts";
import type { PipelineSnapshot } from "./pipeline-observation.ts";

type QueryDaemonListsDeps = Pick<CliDeps, "connectIpcClient" | "socketPath">;

/** Outer CLI-facing RPC timeout for pipeline owner/list resolution. Predecessor merge queries (`daemon-stable-run-routing.ts`) use a strictly shorter timeout so a slow predecessor cannot push a stable reply past this bound. */
export const PIPELINE_OWNER_RPC_TIMEOUT_MS = 2_000;

export const PIPELINE_NO_LIVE_OWNER_RECOVERY = "jarvis daemon start, then retry";
/** `not_owner` now means a live foreign owner that did not answer (a dead owner is adopted by the answering daemon). */
export const PIPELINE_UNREACHABLE_OWNER_RECOVERY =
  "wait for its owning daemon to exit (a draining generation hands it to the live daemon), then retry";

type PipelineListQueryResult = {
  snapshotsBySocketPath: Readonly<Record<string, readonly PipelineSnapshot[]>>;
  hasMalformedResponse: boolean;
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

type PipelineIdCrossDaemonResolution =
  | { kind: "resolved"; pipelineId: string }
  | { kind: "ambiguous"; candidates: string[]; message: string }
  | { kind: "incomplete"; message: string }
  /** Nothing matched; the caller keeps its own not-found handling for the argument as given. */
  | { kind: "unmatched"; pipelineId: string };

/** Queries only the stable address's merged `pipeline_list`; `degraded` mirrors the stable daemon's predecessor-merge flag. */
export async function queryStablePipelineList(
  deps: Pick<QueryDaemonListsDeps, "connectIpcClient" | "socketPath">,
  params: PipelineListRequestParams | undefined,
  timeoutMs = PIPELINE_OWNER_RPC_TIMEOUT_MS,
): Promise<{ snapshots?: readonly PipelineSnapshot[]; malformed: boolean; degraded: boolean }> {
  try {
    const client = await connectWithinTimeout(deps.connectIpcClient, deps.socketPath, timeoutMs);
    const transport = createRpcTransport(client);
    try {
      const result = await transport.request("pipeline_list", params, { timeoutMs });
      const snapshots = parsePipelineList(result);
      if (snapshots === undefined) return { malformed: true, degraded: false };
      return { snapshots, malformed: false, degraded: isRecord(result) && result.degraded === true };
    } catch {
      return { malformed: false, degraded: false };
    } finally {
      transport.close();
    }
  } catch {
    return { malformed: false, degraded: false };
  }
}

/**
 * Resolves a CLI pipeline id argument (exact id or unique ≥8-char prefix, dismissed pipelines
 * included) against the stable address's merged listing only, the same listing `pipeline list`
 * queries. A malformed/unavailable or `degraded` listing refuses prefix resolution; an exact id
 * present in the listing still resolves. Never starts a daemon.
 */
export async function resolvePipelineIdAcrossDaemons(
  argument: string,
  deps: QueryDaemonListsDeps,
  timeoutMs = PIPELINE_OWNER_RPC_TIMEOUT_MS,
): Promise<PipelineIdCrossDaemonResolution> {
  // sinceMs: 0 takes the daemon's filtered bypass so the terminal-retention cap cannot evict a
  // pipeline out of the candidate id set; a prefix the operator read from an earlier listing must
  // keep resolving.
  const listing = await queryStablePipelineList(deps, { includeDismissed: true, sinceMs: 0 }, timeoutMs);
  const ids = (listing.snapshots ?? []).map((snapshot) => snapshot.pipelineId);
  if (ids.includes(argument)) return { kind: "resolved", pipelineId: argument };
  if (argument.length < PIPELINE_ID_PREFIX_MIN_LENGTH) return { kind: "unmatched", pipelineId: argument };
  if (listing.snapshots === undefined || listing.degraded) {
    return {
      kind: "incomplete",
      message: `pipeline_id_set_incomplete: Cannot resolve prefix ${argument}: the daemon listing was malformed, unavailable, or degraded; restore daemon connectivity or use a known full pipeline id.`,
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
