import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getExecutableTreeDigest } from "../../../shared/executable-tree.ts";
import { getCurrentHeadAsync } from "../../../shared/git.ts";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { connectIpcClient } from "../ipc/client";
import { createRpcTransport } from "../ipc/rpc-transport";
import { parseDaemonBindFailureLogLine } from "../ipc/server.ts";
import { jarvisHome } from "../paths.ts";
import { openLogReader, openLogSink } from "../persistence/log-stream.ts";
import { isTerminalRunStatus, openStateStore, type StateStore } from "../persistence/state-store";
import { type RequestChangeover, requestChangeoverFromPublicPeer } from "./daemon-changeover.ts";
import { reconcileOrphanedRuns } from "./daemon-run-reconciliation.ts";
import { parseListRuns, parseStatusResult } from "./daemon-wire";

/**
 * A non-forced stop refuses only non-terminal rows the daemon reports live. Orphaned rows (non-terminal,
 * not live) are named separately so the operator can tell the guard working from the old deadlock.
 */
export class DaemonStopRefusedError extends Error {
  constructor(
    readonly liveRunIds: readonly string[],
    readonly orphanedRunIds: readonly string[] = [],
  ) {
    const orphaned = orphanedRunIds.length > 0 ? `; orphaned (reconciled on stop): ${orphanedRunIds.join(", ")}` : "";
    super(`live durable runs: ${liveRunIds.join(", ")}${orphaned}`);
    this.name = "DaemonStopRefusedError";
  }
}

export class DaemonStopInspectionError extends Error {
  constructor(cause: unknown) {
    super(`failed to inspect durable runs: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "DaemonStopInspectionError";
  }
}

export class DaemonAlreadyRunningError extends Error {
  constructor(socketPath: string) {
    super(`Daemon already running on socket ${socketPath}`);
    this.name = "DaemonAlreadyRunningError";
  }
}

/**
 * Raised when an occupied public address does not hand off: the occupant's `changeover` request
 * failed (unanswered, timed out, or errored) or it never released the address within bound. Either
 * way, the incoming generation fails startup rather than unlinking a live peer's socket.
 */
export class DaemonHandoffFailedError extends Error {
  constructor(socketPath: string) {
    super(`Daemon at socket ${socketPath} did not hand off the address; refusing to replace a live peer's socket.`);
    this.name = "DaemonHandoffFailedError";
  }
}

export class DaemonReadinessTimeoutError extends Error {
  constructor(socketPath: string, timeoutMs: number) {
    super(`Daemon failed to become ready on socket ${socketPath} within ${timeoutMs}ms`);
    this.name = "DaemonReadinessTimeoutError";
  }
}

type DaemonMetadata = {
  pid: number;
  socketPath: string;
};

export type ProcessProber = {
  isAlive(pid: number): boolean;
};

export type SocketProber = {
  probe(socketPath: string, timeoutMs: number): Promise<boolean>;
};

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function probeSocket(socketPath: string, timeoutMs: number): Promise<boolean> {
  try {
    const client = await connectIpcClient(socketPath);
    const transport = createRpcTransport(client);
    try {
      await transport.request("health", undefined, { timeoutMs });
      return true;
    } finally {
      transport.close();
    }
  } catch {
    return false;
  }
}

async function readBindFailureFromLog(logPath: string, logOffsetBytes = 0, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(logPath)) {
      const content = readFileSync(logPath, "utf-8").slice(logOffsetBytes);
      for (const line of content.split("\n").reverse()) {
        const bindFailure = parseDaemonBindFailureLogLine(line);
        if (bindFailure !== undefined) {
          return bindFailure;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return undefined;
}

function setupLogFile(logPath: string, logCapBytes: number): number | undefined {
  const logDir = dirname(logPath);
  if (!existsSync(logDir)) {
    throw new Error(`Log file directory does not exist: ${logDir}`);
  }

  // Rotate log if it exists and is at or over the cap
  if (existsSync(logPath)) {
    const stat = statSync(logPath);
    if (stat.size >= logCapBytes) {
      renameSync(logPath, `${logPath}.1`);
    }
  }

  // Open log file in append mode
  try {
    return openSync(logPath, "a");
  } catch (_error) {
    throw new Error(`Failed to open log file for writing: ${logPath}`);
  }
}

/**
 * Polls until `socketPath` stops answering (the occupant released it) or `timeoutMs` elapses.
 * Called only after a successful `changeover` reply, so a `false` return means the occupant agreed
 * to hand off but never actually released the address — treated the same as an unanswered request.
 */
async function waitForPublicRelease(
  socketPath: string,
  timeoutMs: number,
  socketProber: SocketProber,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const stillUp = await socketProber.probe(socketPath, 200);
    if (!stillUp) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: daemon startup sequences socket probing, occupancy-aware handoff, spawn, and readiness handshake as one ordered lifecycle; each branch depends on the prior step's outcome, so extracting them would thread the whole startup state through helpers without reducing the real decision count.
export async function startDaemon(
  socketPath: string,
  options?: {
    daemonScript?: string;
    readinessTimeoutMs?: number;
    pidPath?: string;
    logPath?: string;
    logCapBytes?: number;
    processProber?: ProcessProber;
    socketProber?: SocketProber;
    testOwnerPid?: number;
    onSpawn?: (pid: number) => void;
    /** Digest-keyed private endpoint the spawned daemon binds before the public address. */
    privateSocketPath?: string;
    /** Requests changeover from an occupying peer; defaults to `requestChangeoverFromPublicPeer`. */
    requestChangeover?: RequestChangeover;
    /** Bounds the `changeover` RPC itself. Defaults to 2000ms. */
    changeoverTimeoutMs?: number;
    /** Bounds how long to wait for the occupant to actually release the address after a successful changeover reply. Defaults to 5000ms. */
    changeoverReleaseTimeoutMs?: number;
  },
): Promise<DaemonMetadata> {
  const readinessTimeoutMs = options?.readinessTimeoutMs ?? 5_000;
  const logCapBytes = options?.logCapBytes ?? 5 * 1024 * 1024;
  const processProber = options?.processProber ?? { isAlive: isProcessAlive };
  const socketProber = options?.socketProber ?? { probe: probeSocket };

  let predecessorSocketPath: string | undefined;
  const alreadyUp = await socketProber.probe(socketPath, 500);
  if (alreadyUp) {
    // Replaces the old immediate refusal: an occupied public address is a handoff, not a rejection.
    // Either failure mode below — an unanswered/errored request, or a request the occupant accepted
    // but never actually released — fails startup without ever unlinking the occupant's socket.
    const requestChangeover = options?.requestChangeover ?? requestChangeoverFromPublicPeer;
    const outcome = await requestChangeover(socketPath, { timeoutMs: options?.changeoverTimeoutMs ?? 2_000 });
    if (outcome.kind === "handoff-failed") {
      throw new DaemonHandoffFailedError(socketPath);
    }
    const released = await waitForPublicRelease(socketPath, options?.changeoverReleaseTimeoutMs ?? 5_000, socketProber);
    if (!released) {
      throw new DaemonHandoffFailedError(socketPath);
    }
    // The outgoing generation's own private endpoint, so the spawned successor can observe its
    // drain (see `daemon-drain-observer.ts`) rather than treating its already-admitted work as
    // gone the moment it stops holding the public address.
    predecessorSocketPath = outcome.privateSocketPath;
  }

  const daemonScript = options?.daemonScript ?? resolve(import.meta.dir, "../daemon-entrypoint.ts");

  const logFd = options?.logPath ? setupLogFile(options.logPath, logCapBytes) : undefined;
  const logOffsetBytes =
    options?.logPath !== undefined && existsSync(options.logPath) ? statSync(options.logPath).size : 0;

  const proc = spawn("bun", [daemonScript], {
    detached: true,
    stdio: logFd !== undefined ? ["ignore", logFd, logFd] : "ignore",
    env: {
      ...process.env,
      DAEMON_SOCKET_PATH: socketPath,
      ...(options?.privateSocketPath === undefined ? {} : { DAEMON_PRIVATE_SOCKET_PATH: options.privateSocketPath }),
      ...(predecessorSocketPath === undefined ? {} : { DAEMON_PREDECESSOR_SOCKET_PATH: predecessorSocketPath }),
      ...(options?.testOwnerPid === undefined ? {} : { TEST_DAEMON_OWNER_PID: String(options.testOwnerPid) }),
    },
  });

  // Close parent's copy of the log fd
  if (logFd !== undefined) {
    try {
      closeSync(logFd);
    } catch {
      // Ignore close errors
    }
  }

  if (proc.pid === undefined) {
    throw new Error("Failed to spawn daemon process: pid is undefined");
  }
  const pid = proc.pid;
  options?.onSpawn?.(pid);
  proc.unref();

  const pidDir = options?.pidPath === undefined ? undefined : dirname(options.pidPath);
  if (options?.pidPath !== undefined && pidDir !== undefined && !existsSync(pidDir)) {
    throw new Error(`PID file directory does not exist: ${pidDir}`);
  }

  const startTime = Date.now();
  while (Date.now() - startTime < readinessTimeoutMs) {
    if (!processProber.isAlive(pid)) {
      if (options?.logPath !== undefined) {
        const bindFailure = await readBindFailureFromLog(options.logPath, logOffsetBytes);
        if (bindFailure !== undefined) {
          throw bindFailure;
        }
      }
      throw new Error(`Daemon process ${pid} died during startup`);
    }
    const up = await socketProber.probe(socketPath, 100);
    if (up) {
      // Recorded only once this daemon is actually serving. Writing it at spawn time let a
      // doomed start (one that never binds) overwrite a healthy daemon's pid with a dead one,
      // which made `daemon status` report `stopped` for a daemon that was answering fine.
      if (options?.pidPath !== undefined) {
        writeFileSync(options.pidPath, String(pid));
      }
      return { pid, socketPath };
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  throw new DaemonReadinessTimeoutError(socketPath, readinessTimeoutMs);
}

async function terminateProcess(pid: number, killTimeoutMs: number, processProber: ProcessProber): Promise<void> {
  const killStart = Date.now();
  let terminated = false;

  while (Date.now() - killStart < killTimeoutMs) {
    if (!processProber.isAlive(pid)) {
      terminated = true;
      break;
    }
    if (Date.now() - killStart < 100) {
      process.kill(pid, "SIGTERM");
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  if (!terminated && processProber.isAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // process may have exited between check and kill
    }
  }
}

/** Ask the daemon which run ids it holds live; throws when it does not answer. */
async function defaultListLiveRunIds(socketPath: string): Promise<readonly string[]> {
  const client = await connectIpcClient(socketPath);
  const transport = createRpcTransport(client);
  try {
    const listed = parseListRuns(await transport.request("list", undefined, { timeoutMs: 2_000 }));
    if (listed === undefined) throw new Error("malformed list response");
    return listed.runs.filter((row) => row.isLive).map((row) => row.runId);
  } finally {
    transport.close();
  }
}

/**
 * Split non-terminal durable rows into live (the daemon holds them) and orphaned (nobody does).
 * An unreachable daemon is not evidence that nothing is running, so `liveRunIds === undefined`
 * counts every non-terminal row as live.
 */
function partitionNonTerminalRuns(
  stateStore: Pick<StateStore, "listRuns" | "close"> | undefined,
  liveRunIds: ReadonlySet<string> | undefined,
): { live: string[]; orphaned: string[] } {
  let store = stateStore;
  let ownsStore = false;
  try {
    if (store === undefined) {
      store = openStateStore();
      ownsStore = true;
    }
    const nonTerminal = store
      .listRuns()
      .filter((run) => !isTerminalRunStatus(run.status))
      .map((run) => run.id);
    if (liveRunIds === undefined) return { live: nonTerminal, orphaned: [] };
    return {
      live: nonTerminal.filter((id) => liveRunIds.has(id)),
      orphaned: nonTerminal.filter((id) => !liveRunIds.has(id)),
    };
  } catch (error) {
    throw new DaemonStopInspectionError(error);
  } finally {
    if (ownsStore) store?.close();
  }
}

/** Settle orphaned non-terminal rows through the same path daemon startup uses. */
async function defaultReconcileOrphans(logsPath: string): Promise<string[]> {
  const store = openStateStore();
  const sink = openLogSink(logsPath);
  try {
    return await reconcileOrphanedRuns(store, sink, openLogReader(logsPath));
  } finally {
    sink.close();
    store.close();
  }
}

export async function stopDaemon(
  socketPath: string,
  options?: {
    drainTimeoutMs?: number;
    killTimeoutMs?: number;
    pidPath?: string;
    force?: boolean;
    stateStore?: Pick<StateStore, "listRuns" | "close">;
    processProber?: ProcessProber;
    /** Live run ids as the daemon reports them; rejection means "unreachable" and counts every non-terminal row live. */
    listLiveRunIds?: (socketPath: string) => Promise<readonly string[]>;
    /** Stop-time reconciliation of orphaned rows; defaults to the shared startup path over the state store and log stream. */
    reconcileOrphans?: (orphanedRunIds: readonly string[]) => Promise<string[]>;
    logsPath?: string;
  },
): Promise<{ reconciledRunIds: string[] }> {
  const drainTimeoutMs = options?.drainTimeoutMs ?? 2_000;
  const killTimeoutMs = options?.killTimeoutMs ?? 3_000;
  const processProber = options?.processProber ?? { isAlive: isProcessAlive };

  let liveRunIds: ReadonlySet<string> | undefined;
  try {
    liveRunIds = new Set(await (options?.listLiveRunIds ?? defaultListLiveRunIds)(socketPath));
  } catch {
    liveRunIds = undefined;
  }
  const rows = partitionNonTerminalRuns(options?.stateStore, liveRunIds);
  if (!options?.force && rows.live.length > 0) {
    throw new DaemonStopRefusedError(rows.live, rows.orphaned);
  }

  let pid: number | null = null;
  if (options?.pidPath && existsSync(options.pidPath)) {
    try {
      pid = parseInt(readFileSync(options.pidPath, "utf-8"), 10);
    } catch {
      // ignore parse errors, pidPath is optional
    }
  }

  try {
    const client = await connectIpcClient(socketPath);
    const transport = createRpcTransport(client);
    try {
      await transport.request("shutdown", undefined, { timeoutMs: drainTimeoutMs });
    } catch {
      // timeout or error is expected; just close
    } finally {
      transport.close();
    }
  } catch {
    // socket may not be reachable; process-side shutdown signal is fallback
  }

  if (pid) {
    await terminateProcess(pid, killTimeoutMs, processProber);
  }

  if (options?.pidPath) {
    rmSync(options.pidPath, { force: true });
  }

  // The daemon is down, so its rows have no live owner: settle them the way startup would.
  const orphaned = [...rows.orphaned, ...(options?.force ? rows.live : [])];
  if (orphaned.length === 0) return { reconciledRunIds: [] };
  const logsPath = options?.logsPath ?? join(jarvisHome(), "state", "logs.jsonl");
  const reconcile = options?.reconcileOrphans ?? (() => defaultReconcileOrphans(logsPath));
  return { reconciledRunIds: await reconcile(orphaned) };
}

type DaemonStatusResult =
  | { state: "running"; loadedRevision: string; currentRevision: string }
  | { state: "stale"; loadedRevision: string; currentRevision: string }
  | { state: "stopped" };

type GetCurrentRevisionFn = () => Promise<string>;

const jarvisRepoRoot = resolve(import.meta.dir, "../../..");

export async function getDaemonStatus(
  socketPath: string,
  options?: {
    healthTimeoutMs?: number;
    socketProber?: SocketProber;
    getCurrentRevision?: GetCurrentRevisionFn;
    getExecutableDigest?: () => Promise<string>;
    connectIpcClient?: typeof connectIpcClient;
  },
): Promise<DaemonStatusResult> {
  const healthTimeoutMs = options?.healthTimeoutMs ?? 1_000;
  const socketProber = options?.socketProber ?? { probe: probeSocket };

  // The socket is the service, so it decides. A recorded pid can be stale or absent while a
  // daemon is serving normally, and reporting `stopped` for a reachable daemon sends operators
  // into destructive recovery for a machine that is working.
  const up = await socketProber.probe(socketPath, healthTimeoutMs);
  if (!up) {
    return { state: "stopped" };
  }

  let loadedRevision: string | undefined;
  let loadedExecutableDigest: string | undefined;
  const connectClient = options?.connectIpcClient ?? connectIpcClient;

  try {
    const client = await connectClient(socketPath);
    const transport = createRpcTransport(client);
    try {
      const response = await transport.request("status", undefined, { timeoutMs: healthTimeoutMs });
      const daemonStatus = parseStatusResult(response);

      if (!daemonStatus) {
        return { state: "stopped" };
      }

      loadedRevision = daemonStatus.loadedRevision;
      loadedExecutableDigest = daemonStatus.loadedExecutableDigest;
    } finally {
      transport.close();
    }
  } catch {
    return { state: "stopped" };
  }

  if (!loadedRevision || !loadedExecutableDigest) {
    return { state: "stopped" };
  }

  let currentRevision = "unknown";
  let currentExecutableDigest = "unknown";
  try {
    if (options?.getCurrentRevision) {
      currentRevision = await options.getCurrentRevision();
    } else {
      currentRevision = await getCurrentHeadAsync(jarvisRepoRoot, realAsyncSubprocessRunner);
    }
    if (options?.getExecutableDigest) {
      currentExecutableDigest = await options.getExecutableDigest();
    } else {
      currentExecutableDigest = await getExecutableTreeDigest(jarvisRepoRoot, realAsyncSubprocessRunner);
    }
  } catch {
    // Leave as "unknown" if we can't determine current revision or digest
  }

  const isSame = loadedExecutableDigest === currentExecutableDigest;
  return {
    state: isSame ? "running" : "stale",
    loadedRevision,
    currentRevision,
  };
}
