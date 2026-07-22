import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CliDeps } from "../cli/deps.ts";
import type { Io } from "../cli/io.ts";
import { formatLifecycleError } from "../cli/ipc.ts";
import { DAEMON_LOG_USAGE, DAEMON_USAGE } from "../cli/usage.ts";
import { connectIpcClient } from "../ipc/client.ts";
import { createRpcTransport } from "../ipc/rpc-transport.ts";

type ClassifiedSocket = {
  path: string;
  status: "dead" | "live" | "preserved";
  reason?: string;
};

export async function reapDeadDaemonSockets(
  jarvisRoot: string,
): Promise<{ dead: string[]; preserved: Array<{ path: string; reason: string }> }> {
  const dead: string[] = [];
  const preserved: Array<{ path: string; reason: string }> = [];

  if (!existsSync(jarvisRoot)) {
    return { dead, preserved };
  }

  let entries: string[];
  try {
    entries = readdirSync(jarvisRoot);
  } catch {
    return { dead, preserved };
  }

  const socketFiles = entries.filter((name) => name.startsWith("daemon-") && name.endsWith(".sock"));

  for (const socketFile of socketFiles) {
    const socketPath = join(jarvisRoot, socketFile);
    const classification = await classifySocket(socketPath);
    if (classification.status === "dead") {
      dead.push(socketPath);
    } else if (classification.status === "preserved" && classification.reason) {
      preserved.push({ path: socketPath, reason: classification.reason });
    }
  }

  return { dead, preserved };
}

async function classifySocket(socketPath: string): Promise<ClassifiedSocket> {
  try {
    const client = await connectIpcClient(socketPath);
    const transport = createRpcTransport(client);
    try {
      await transport.request("health", undefined, { timeoutMs: 500 });
      return { path: socketPath, status: "live" };
    } finally {
      transport.close();
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ECONNREFUSED" || err.code === "ENOENT") {
      return { path: socketPath, status: "dead" };
    }
    const reason = err.message || String(error);
    return { path: socketPath, status: "preserved", reason };
  }
}

function readPid(pidPath: string): number | null {
  if (!existsSync(pidPath)) return null;
  const raw = readFileSync(pidPath, "utf8").trim();
  if (raw.length === 0) return null;
  const pid = Number.parseInt(raw, 10);
  return Number.isNaN(pid) ? null : pid;
}

async function handleStopCommand(argv: readonly string[], io: Io, deps: CliDeps): Promise<number | null> {
  if (!(argv.length === 1 || (argv.length === 2 && argv[1] === "--force"))) {
    return null;
  }
  try {
    await deps.stopDaemon(deps.socketPath, { pidPath: deps.pidPath, force: argv[1] === "--force" });
    io.stdout("stopped\n");
    return 0;
  } catch (error) {
    io.stderr(formatLifecycleError(error));
    return 1;
  }
}

export async function runDaemonCommand(argv: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  const subcommand = argv[0];

  if (subcommand === "start" && argv.length === 1) {
    try {
      const result = await deps.startDaemon(deps.socketPath, { pidPath: deps.pidPath, logPath: deps.logPath });
      io.stdout(`${JSON.stringify(result)}\n`);
      return 0;
    } catch (error) {
      io.stderr(formatLifecycleError(error));
      return 1;
    }
  }

  if (subcommand === "stop") {
    const result = await handleStopCommand(argv, io, deps);
    if (result !== null) return result;
  }

  if (subcommand === "status" && argv.length === 1) {
    const pid = readPid(deps.pidPath);
    if (pid === null) {
      io.stdout("stopped\n");
      return 1;
    }

    const status = await deps.getDaemonStatus(pid, deps.socketPath);
    if (status.state === "stopped") {
      io.stdout("stopped\n");
      return 1;
    }
    const output = `${status.state} loaded=${status.loadedRevision} current=${status.currentRevision}`;
    io.stdout(`${output}\n`);
    return status.state === "running" ? 0 : 1;
  }

  if (subcommand === "log") {
    if (argv.length === 1) {
      return deps.readDaemonProcessLog(deps.logPath, { writeOut: io.stdout, writeErr: io.stderr });
    }
    if (argv.length === 2 && argv[1] === "--follow") {
      const controller = new AbortController();
      const unregister = deps.onSigint(() => controller.abort());
      try {
        return await deps.followDaemonProcessLog(
          deps.logPath,
          { writeOut: io.stdout, writeErr: io.stderr },
          controller.signal,
        );
      } finally {
        unregister();
      }
    }
    io.stderr(DAEMON_LOG_USAGE);
    return 1;
  }

  io.stderr(DAEMON_USAGE);
  return 1;
}
