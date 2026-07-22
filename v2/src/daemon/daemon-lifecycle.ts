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

function readLeaseOwner(pidPath: string): number | undefined {
  try {
    const value = readFileSync(pidPath, "utf-8").trim();
    const pid = Number(value.startsWith("starting:") ? value.split(":")[1] : value);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function hasMalformedLease(pidPath: string): boolean {
  try {
    return readLeaseOwner(pidPath) === undefined;
  } catch {
    return false;
  }
}

function removeLeaseIfOwned(pidPath: string, owner: string): void {
  try {
    if (readFileSync(pidPath, "utf-8").trim() === owner) rmSync(pidPath, { force: true });
  } catch {
    // A concurrent owner may have replaced or removed the lease.
  }
}

type StartDaemonOptions = {
  daemonScript?: string;
  readinessTimeoutMs?: number;
  pidPath?: string;
  logPath?: string;
  logCapBytes?: number;
  processProber?: ProcessProber;
  socketProber?: SocketProber;
  testOwnerPid?: number;
  onSpawn?: (pid: number) => void;
};

function acquireLease(
  socketPath: string,
  pidPath: string | undefined,
  processProber: ProcessProber,
): string | undefined {
  if (pidPath === undefined) return undefined;
  const pidDir = dirname(pidPath);
  if (!existsSync(pidDir)) throw new Error(`PID file directory does not exist: ${pidDir}`);
  const leaseOwner = `starting:${process.pid}:${crypto.randomUUID()}`;
  for (;;) {
    try {
      writeFileSync(pidPath, leaseOwner, { flag: "wx" });
      return leaseOwner;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = readLeaseOwner(pidPath);
      if (owner === undefined && hasMalformedLease(pidPath)) throw new DaemonAlreadyRunningError(socketPath);
      if (owner !== undefined && processProber.isAlive(owner)) throw new DaemonAlreadyRunningError(socketPath);
      rmSync(pidPath, { force: true });
    }
  }
}

function spawnDaemon(socketPath: string, options: StartDaemonOptions, logCapBytes: number): number {
  const daemonScript = options.daemonScript ?? resolve(import.meta.dir, "../daemon-entrypoint.ts");
  const logFd = options.logPath ? setupLogFile(options.logPath, logCapBytes) : undefined;
  const proc = spawn("bun", [daemonScript], {
    detached: true,
    stdio: logFd !== undefined ? ["ignore", logFd, logFd] : "ignore",
    env: {
      ...process.env,
      DAEMON_SOCKET_PATH: socketPath,
      ...(options.pidPath === undefined ? {} : { DAEMON_PID_PATH: options.pidPath }),
      ...(options.testOwnerPid === undefined ? {} : { TEST_DAEMON_OWNER_PID: String(options.testOwnerPid) }),
    },
  });
  if (logFd !== undefined) {
    try {
      closeSync(logFd);
    } catch {
      // Ignore close errors.
    }
  }
  if (proc.pid === undefined) throw new Error("Failed to spawn daemon process: pid is undefined");
  options.onSpawn?.(proc.pid);
  proc.unref();
  return proc.pid;
}

async function waitForDaemonReady(
  socketPath: string,
  pid: number,
  readinessTimeoutMs: number,
  processProber: ProcessProber,
  socketProber: SocketProber,
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < readinessTimeoutMs) {
    if (!processProber.isAlive(pid)) throw new Error(`Daemon process ${pid} died during startup`);
    if (await socketProber.probe(socketPath, 100)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new DaemonReadinessTimeoutError(socketPath, readinessTimeoutMs);
}

export async function startDaemon(socketPath: string, options?: StartDaemonOptions): Promise<DaemonMetadata> {
  const readinessTimeoutMs = options?.readinessTimeoutMs ?? 5_000;
  const logCapBytes = options?.logCapBytes ?? 5 * 1024 * 1024;
  const processProber = options?.processProber ?? { isAlive: isProcessAlive };
  const socketProber = options?.socketProber ?? { probe: probeSocket };

  if (await socketProber.probe(socketPath, 500)) throw new DaemonAlreadyRunningError(socketPath);
  let leaseOwner = acquireLease(socketPath, options?.pidPath, processProber);
  let spawnedPid: number | undefined;
  try {
    const pid = spawnDaemon(socketPath, options ?? {}, logCapBytes);
    spawnedPid = pid;

    if (options?.pidPath && leaseOwner !== undefined) {
      if (readFileSync(options.pidPath, "utf-8").trim() !== leaseOwner) {
        throw new DaemonAlreadyRunningError(socketPath);
      }
      writeFileSync(options.pidPath, String(pid));
      leaseOwner = String(pid);
    }

    await waitForDaemonReady(socketPath, pid, readinessTimeoutMs, processProber, socketProber);
    return { pid, socketPath };
  } catch (error) {
    if (options?.pidPath !== undefined && spawnedPid !== undefined) {
      await terminateProcess(spawnedPid, 3_000, processProber);
    }
    if (options?.pidPath && leaseOwner !== undefined) removeLeaseIfOwned(options.pidPath, leaseOwner);
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
function assertStopAllowed(stateStore: Pick<StateStore, "listRuns" | "close"> | undefined): void {
  let store = stateStore;
  let ownsStore = false;
  try {
    if (store === undefined) {
      store = openStateStore();
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
    processProber?: ProcessProber;
  },
): Promise<void> {
  const drainTimeoutMs = options?.drainTimeoutMs ?? 2_000;
  const killTimeoutMs = options?.killTimeoutMs ?? 3_000;
  const processProber = options?.processProber ?? { isAlive: isProcessAlive };

  if (!options?.force) {
    assertStopAllowed(options?.stateStore);
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
