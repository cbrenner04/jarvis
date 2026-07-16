import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { connectIpcClient } from "../ipc/client";
import { createRpcTransport } from "../ipc/rpc-transport";
import { openStateStore, type StateStore } from "../persistence/state-store";

const STOP_TERMINAL_STATUSES = new Set(["completed", "failed", "blocked", "killed"]);

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

export type DaemonStatus = { state: "running"; loadedRevision: string } | { state: "stopped" };

export type DaemonStatusProber = {
  status(socketPath: string, timeoutMs: number): Promise<DaemonStatus>;
};

/** Resolve the full commit of the Jarvis checkout containing this source file. */
export function resolveSourceRevision(): string {
  return execFileSync("git", ["-C", resolve(import.meta.dir, "../../.."), "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

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

async function probeDaemonStatus(socketPath: string, timeoutMs: number): Promise<DaemonStatus> {
  try {
    const client = await connectIpcClient(socketPath);
    const transport = createRpcTransport(client);
    try {
      const result = await transport.request("status", undefined, { timeoutMs });
      if (
        typeof result === "object" &&
        result !== null &&
        (result as { state?: unknown }).state === "running" &&
        typeof (result as { loadedRevision?: unknown }).loadedRevision === "string"
      ) {
        return { state: "running", loadedRevision: (result as { loadedRevision: string }).loadedRevision };
      }
    } finally {
      transport.close();
    }
  } catch {
    // A reachable socket without a valid status response is not a live daemon.
  }
  return { state: "stopped" };
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
    sourceRevision?: string;
  },
): Promise<DaemonMetadata> {
  const readinessTimeoutMs = options?.readinessTimeoutMs ?? 5_000;
  const logCapBytes = options?.logCapBytes ?? 5 * 1024 * 1024;
  const processProber = options?.processProber ?? { isAlive: isProcessAlive };
  const socketProber = options?.socketProber ?? { probe: probeSocket };

  const alreadyUp = await socketProber.probe(socketPath, 500);
  if (alreadyUp) {
    throw new DaemonAlreadyRunningError(socketPath);
  }

  const daemonScript = options?.daemonScript ?? resolve(import.meta.dir, "../daemon-entrypoint.ts");

  const logFd = options?.logPath ? setupLogFile(options.logPath, logCapBytes) : undefined;

  const sourceRevision = options?.sourceRevision ?? resolveSourceRevision();
  const proc = spawn("bun", [daemonScript], {
    detached: true,
    stdio: logFd !== undefined ? ["ignore", logFd, logFd] : "ignore",
    env: { ...process.env, DAEMON_SOCKET_PATH: socketPath, DAEMON_SOURCE_REVISION: sourceRevision },
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
  proc.unref();

  if (options?.pidPath) {
    const pidDir = dirname(options.pidPath);
    if (!existsSync(pidDir)) {
      throw new Error(`PID file directory does not exist: ${pidDir}`);
    }
    writeFileSync(options.pidPath, String(pid));
  }

  const startTime = Date.now();
  while (Date.now() - startTime < readinessTimeoutMs) {
    if (!processProber.isAlive(pid)) {
      throw new Error(`Daemon process ${pid} died during startup`);
    }
    const up = await socketProber.probe(socketPath, 100);
    if (up) {
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
      .filter((run) => !STOP_TERMINAL_STATUSES.has(run.status))
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

export async function getDaemonStatus(
  pid: number,
  socketPath: string,
  options?: {
    healthTimeoutMs?: number;
    processProber?: ProcessProber;
    socketProber?: SocketProber;
    statusProber?: DaemonStatusProber;
  },
): Promise<DaemonStatus> {
  const healthTimeoutMs = options?.healthTimeoutMs ?? 1_000;
  const processProber = options?.processProber ?? { isAlive: isProcessAlive };
  const socketProber = options?.socketProber ?? { probe: probeSocket };

  if (!processProber.isAlive(pid)) {
    return { state: "stopped" };
  }

  const up = await socketProber.probe(socketPath, healthTimeoutMs);
  if (!up) return { state: "stopped" };

  const statusProber = options?.statusProber ?? { status: probeDaemonStatus };
  return statusProber.status(socketPath, healthTimeoutMs);
}
