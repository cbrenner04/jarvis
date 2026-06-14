import { type ChildProcess, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callDaemon, isDaemonReachable, removeStaleSocket } from "./client.ts";
import { daemonSocketPath, ensureJarvisRoot } from "./paths.ts";

/** Default readiness wait for a spawned daemon to answer `status`. */
export const DAEMON_READINESS_TIMEOUT_MS = 5_000;

export type AutostartFailureReason = "already_running" | "spawn_failed" | "readiness_timeout";

export type AutostartResult = { ok: true } | { ok: false; reason: AutostartFailureReason; detail: string };

export type SpawnDaemon = (args: {
  command: string;
  argv: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}) => ChildProcess;

export type EnsureDaemonRunningOptions = {
  jarvisRoot: string;
  socketPath?: string;
  readinessTimeoutMs?: number;
  spawnDaemon?: SpawnDaemon;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Resolve the executable used to launch `daemon serve`.
 * Prefers the `jarvis` wrapper when the current process was started through it.
 */
export function discoverJarvisExecutable(): { command: string; serveArgv: readonly string[] } {
  const entry = process.argv[1];
  if (entry?.endsWith("/bin/jarvis")) {
    return { command: entry, serveArgv: ["daemon", "serve"] };
  }
  if (entry?.endsWith("cli.ts")) {
    return { command: "bun", serveArgv: ["run", entry, "daemon", "serve"] };
  }

  const fallback = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.ts");
  return { command: "bun", serveArgv: ["run", fallback, "daemon", "serve"] };
}

/**
 * Spawn a detached daemon when the socket is not already live.
 * Used by `daemon start` today and by later run-control clients.
 */
export async function ensureDaemonRunning(options: EnsureDaemonRunningOptions): Promise<AutostartResult> {
  const socketPath = options.socketPath ?? daemonSocketPath(options.jarvisRoot);
  if (await isDaemonReachable(socketPath)) {
    return { ok: false, reason: "already_running", detail: "daemon already answers status" };
  }

  try {
    await removeStaleSocket(socketPath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "daemon already running") {
      return { ok: false, reason: "already_running", detail: message };
    }
    throw error;
  }

  const launch = discoverJarvisExecutable();
  const spawnDaemon = options.spawnDaemon ?? defaultSpawnDaemon;
  const child = spawnDaemon({
    command: launch.command,
    argv: [...launch.serveArgv, "--jarvis-root", options.jarvisRoot],
    cwd: process.cwd(),
    env: process.env,
  });

  if (child.pid === undefined) {
    return { ok: false, reason: "spawn_failed", detail: "spawn returned no pid" };
  }

  const timeoutMs = options.readinessTimeoutMs ?? DAEMON_READINESS_TIMEOUT_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isDaemonReachable(socketPath)) {
      return { ok: true };
    }
    await sleep(50);
  }

  return {
    ok: false,
    reason: "readiness_timeout",
    detail: `daemon did not answer status within ${timeoutMs}ms`,
  };
}

function defaultSpawnDaemon(args: {
  command: string;
  argv: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}): ChildProcess {
  ensureJarvisRoot(readJarvisRootArg(args.argv));
  const child = spawn(args.command, [...args.argv], {
    cwd: args.cwd,
    env: args.env,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return child;
}

function readJarvisRootArg(argv: readonly string[]): string {
  const index = argv.indexOf("--jarvis-root");
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (value === undefined) {
    throw new Error("missing --jarvis-root value");
  }
  return value;
}

/** Structured failure object for CLI output when autostart fails. */
export function formatAutostartFailure(result: Extract<AutostartResult, { ok: false }>): {
  reason: AutostartFailureReason;
  detail: string;
} {
  return { reason: result.reason, detail: result.detail };
}

/** Convenience wrapper for run-control clients that need a live daemon. */
export async function callDaemonWithAutostart(
  request: Parameters<typeof callDaemon>[0],
  options: EnsureDaemonRunningOptions & { timeoutMs?: number },
): Promise<Awaited<ReturnType<typeof callDaemon>>> {
  const socketPath = options.socketPath ?? daemonSocketPath(options.jarvisRoot);
  if (!(await isDaemonReachable(socketPath))) {
    const started = await ensureDaemonRunning(options);
    if (!started.ok) {
      return {
        id: request.id,
        ok: false,
        error: {
          code: "autostart_failed",
          message: started.detail,
          data: formatAutostartFailure(started),
        },
      };
    }
  }
  const clientOptions = options.timeoutMs === undefined ? { socketPath } : { socketPath, timeoutMs: options.timeoutMs };
  return callDaemon(request, clientOptions);
}
