import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getExecutableTreeDigest } from "../../../shared/executable-tree.ts";
import { getCurrentHeadAsync } from "../../../shared/git.ts";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { GetExecutableDigest } from "../cli/dispatch-revision.ts";
import { connectIpcClient } from "../ipc/client";
import { createRpcTransport } from "../ipc/rpc-transport";
import { isTerminalRunStatus, openStateStore, type StateStore } from "../persistence/state-store";
import { parseStatusResult } from "./daemon-wire";

export class DaemonStopRefusedError extends Error {
  constructor(readonly runIds: readonly string[]) {
    super(`active durable runs: ${runIds.join(", ")}`);
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

type StartDaemonOptions = {
  daemonScript?: string;
  readinessTimeoutMs?: number;
  pidPath?: string;
  logPath?: string;
  statePath?: string;
  logsPath?: string;
  logCapBytes?: number;
  processProber?: ProcessProber;
  socketProber?: SocketProber;
  openPidLease?: (path: string) => number;
  testOwnerPid?: number;
  onSpawn?: (pid: number) => void;
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

function acquirePidLease(
  socketPath: string,
  options: StartDaemonOptions,
  processProber: ProcessProber,
): number | undefined {
  if (!options.pidPath) return undefined;

  const pidDir = dirname(options.pidPath);
  if (!existsSync(pidDir)) {
    throw new Error(`PID file directory does not exist: ${pidDir}`);
  }

  const openLease = options.openPidLease ?? ((path: string) => openSync(path, "wx"));
  try {
    return openLease(options.pidPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }

  const stalePid = Number(readFileSync(options.pidPath, "utf8").trim());
  if (Number.isInteger(stalePid) && stalePid > 0 && processProber.isAlive(stalePid)) {
    throw new DaemonAlreadyRunningError(socketPath);
  }
  rmSync(options.pidPath, { force: true });
  try {
    return openLease(options.pidPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new DaemonAlreadyRunningError(socketPath);
    throw error;
  }
}

function closeLogFile(logFd: number | undefined): void {
  if (logFd === undefined) return;
  try {
    closeSync(logFd);
  } catch {
    // Ignore close errors
  }
}

function spawnDaemonProcess(
  socketPath: string,
  options: StartDaemonOptions,
  logCapBytes: number,
): { pid: number; logFd: number | undefined } {
  const daemonScript = options.daemonScript ?? resolve(import.meta.dir, "../daemon-entrypoint.ts");
  const logFd = options.logPath ? setupLogFile(options.logPath, logCapBytes) : undefined;
  const proc = spawn("bun", [daemonScript], {
    detached: true,
    stdio: logFd !== undefined ? ["ignore", logFd, logFd] : "ignore",
    env: {
      ...process.env,
      DAEMON_SOCKET_PATH: socketPath,
      ...(options.pidPath === undefined ? {} : { DAEMON_PID_PATH: options.pidPath }),
      ...(options.statePath === undefined ? {} : { DAEMON_STATE_PATH: options.statePath }),
      ...(options.logsPath === undefined ? {} : { DAEMON_LOGS_PATH: options.logsPath }),
      ...(options.testOwnerPid === undefined ? {} : { TEST_DAEMON_OWNER_PID: String(options.testOwnerPid) }),
    },
  });
  if (proc.pid === undefined) {
    closeLogFile(logFd);
    throw new Error("Failed to spawn daemon process: pid is undefined");
  }
  proc.unref();
  return { pid: proc.pid, logFd };
}

function writePidLease(pidFd: number | undefined, pid: number): void {
  if (pidFd === undefined) return;
  try {
    writeFileSync(pidFd, String(pid));
  } finally {
    closeSync(pidFd);
  }
}

async function awaitDaemonReadiness(
  socketPath: string,
  pid: number,
  timeoutMs: number,
  processProber: ProcessProber,
  socketProber: SocketProber,
): Promise<DaemonMetadata> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (!processProber.isAlive(pid)) {
      throw new Error(`Daemon process ${pid} died during startup`);
    }
    if (await socketProber.probe(socketPath, 100)) return { pid, socketPath };
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new DaemonReadinessTimeoutError(socketPath, timeoutMs);
}

export async function startDaemon(socketPath: string, options?: StartDaemonOptions): Promise<DaemonMetadata> {
  const configured = options ?? {};
  const readinessTimeoutMs = configured.readinessTimeoutMs ?? 5_000;
  const logCapBytes = configured.logCapBytes ?? 5 * 1024 * 1024;
  const processProber = configured.processProber ?? { isAlive: isProcessAlive };
  const socketProber = configured.socketProber ?? { probe: probeSocket };

  const alreadyUp = await socketProber.probe(socketPath, 500);
  if (alreadyUp) {
    throw new DaemonAlreadyRunningError(socketPath);
  }

  const pidFd = acquirePidLease(socketPath, configured, processProber);
  let pid: number | undefined;
  let logFd: number | undefined;
  try {
    const spawned = spawnDaemonProcess(socketPath, configured, logCapBytes);
    pid = spawned.pid;
    logFd = spawned.logFd;
    closeLogFile(logFd);
    logFd = undefined;
    configured.onSpawn?.(pid);
    writePidLease(pidFd, pid);
    return await awaitDaemonReadiness(socketPath, pid, readinessTimeoutMs, processProber, socketProber);
  } catch (error) {
    closeLogFile(logFd);
    if (error instanceof DaemonReadinessTimeoutError && pid !== undefined && configured.pidPath !== undefined) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
    }
    if (configured.pidPath) rmSync(configured.pidPath, { force: true });
    throw error;
  }
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

/** Refuse a non-forced stop when the durable store holds any non-terminal run. */
function assertStopAllowed(stateStore: Pick<StateStore, "listRuns" | "close"> | undefined, statePath?: string): void {
  let store = stateStore;
  let ownsStore = false;
  try {
    if (store === undefined) {
      store = openStateStore(statePath);
      ownsStore = true;
    }
    const blockers = store
      .listRuns()
      .filter((run) => !isTerminalRunStatus(run.status))
      .map((run) => run.id);
    if (blockers.length > 0) throw new DaemonStopRefusedError(blockers);
  } catch (error) {
    if (error instanceof DaemonStopRefusedError) throw error;
    throw new DaemonStopInspectionError(error);
  } finally {
    if (ownsStore) store?.close();
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
    statePath?: string;
    processProber?: ProcessProber;
  },
): Promise<void> {
  const drainTimeoutMs = options?.drainTimeoutMs ?? 2_000;
  const killTimeoutMs = options?.killTimeoutMs ?? 3_000;
  const processProber = options?.processProber ?? { isAlive: isProcessAlive };

  if (!options?.force) {
    assertStopAllowed(options?.stateStore, options?.statePath);
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
}

export type DaemonStatusResult =
  | { state: "running"; loadedRevision: string; currentRevision: string }
  | { state: "stale"; loadedRevision: string; currentRevision: string }
  | { state: "stopped" };

export type GetCurrentRevisionFn = () => Promise<string>;

const jarvisRepoRoot = resolve(import.meta.dir, "../../..");

export async function getDaemonStatus(
  pid: number,
  socketPath: string,
  options?: {
    healthTimeoutMs?: number;
    processProber?: ProcessProber;
    socketProber?: SocketProber;
    getCurrentRevision?: GetCurrentRevisionFn;
    getExecutableDigest?: GetExecutableDigest;
    connectIpcClient?: typeof connectIpcClient;
  },
): Promise<DaemonStatusResult> {
  const healthTimeoutMs = options?.healthTimeoutMs ?? 1_000;
  const processProber = options?.processProber ?? { isAlive: isProcessAlive };
  const socketProber = options?.socketProber ?? { probe: probeSocket };

  if (!processProber.isAlive(pid)) {
    return { state: "stopped" };
  }

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
