import { existsSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { callDaemon, isDaemonReachable, removeStaleSocket } from "./client.ts";
import { daemonSocketPath, ensureJarvisRoot } from "./paths.ts";
import {
  type DaemonRequest,
  type DaemonResponse,
  encodeFrame,
  errorResponse,
  okResponse,
  ProtocolError,
  parseRequestLine,
} from "./protocol.ts";

export type DaemonStatusResult = {
  pid: number;
  socketPath: string;
  activeInvocationRunIds: readonly string[];
};

export type DaemonHostOptions = {
  socketPath: string;
  pid?: number;
};

export type DaemonHost = {
  socketPath: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  waitUntilStopped(): Promise<void>;
  registerActiveInvocation(runId: string): void;
  unregisterActiveInvocation(runId: string): void;
  handleRequest(request: DaemonRequest): DaemonResponse;
};

/** Create a daemon host bound to a Unix socket. */
export function createDaemonHost(options: DaemonHostOptions): DaemonHost {
  const activeInvocationRunIds = new Set<string>();
  const pid = options.pid ?? process.pid;
  let server: Server | null = null;
  let shuttingDown = false;
  let stoppedResolve: (() => void) | null = null;
  const stopped = new Promise<void>((resolve) => {
    stoppedResolve = resolve;
  });

  const handleRequest = (request: DaemonRequest): DaemonResponse => {
    if (request.method === "status") {
      return okResponse(request.id, {
        pid,
        socketPath: options.socketPath,
        activeInvocationRunIds: [...activeInvocationRunIds],
      } satisfies DaemonStatusResult);
    }

    if (request.method === "stop") {
      if (activeInvocationRunIds.size > 0) {
        return errorResponse(request.id, {
          code: "active_invocations",
          message: "daemon has active invocations",
          data: { activeRunIds: [...activeInvocationRunIds] },
        });
      }
      queueShutdown();
      return okResponse(request.id, { stopped: true });
    }

    return errorResponse(request.id, {
      code: "unknown_method",
      message: `unknown method: ${request.method}`,
    });
  };

  const queueShutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server?.close(() => {
      if (existsSync(options.socketPath)) {
        unlinkSync(options.socketPath);
      }
      stoppedResolve?.();
    });
  };

  const handleConnection = (socket: Socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let response: DaemonResponse;
        try {
          const request = parseRequestLine(line);
          response = handleRequest(request);
        } catch (error) {
          const requestId = extractRequestId(line) ?? "invalid";
          response = errorResponse(requestId, protocolError(error));
        }
        socket.write(encodeFrame(response));
      }
    });
  };

  return {
    socketPath: options.socketPath,
    start: async () => {
      if (await isDaemonReachable(options.socketPath)) {
        throw new Error("daemon already running");
      }
      await removeStaleSocket(options.socketPath);
      ensureJarvisRoot(dirnameForSocket(options.socketPath));
      await new Promise<void>((resolve, reject) => {
        server = createServer(handleConnection);
        server.once("error", reject);
        server.listen(options.socketPath, () => resolve());
      });
    },
    stop: async () => {
      if (!server) return;
      queueShutdown();
      await stopped;
      server = null;
    },
    waitUntilStopped: () => stopped,
    registerActiveInvocation(runId: string) {
      activeInvocationRunIds.add(runId);
    },
    unregisterActiveInvocation(runId: string) {
      activeInvocationRunIds.delete(runId);
    },
    handleRequest,
  };
}

/** Run the daemon until `stop` is requested or the process is interrupted. */
export async function runDaemonServe(options: DaemonHostOptions): Promise<void> {
  const host = createDaemonHost(options);
  await host.start();
  const onSignal = () => {
    void host.stop();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  await host.waitUntilStopped();
}

function dirnameForSocket(socketPath: string): string {
  const index = socketPath.lastIndexOf("/");
  return index > 0 ? socketPath.slice(0, index) : socketPath;
}

function extractRequestId(line: string): string | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed === "object" && parsed !== null && "id" in parsed && typeof parsed.id === "string") {
      return parsed.id;
    }
  } catch {
    return null;
  }
  return null;
}

function protocolError(error: unknown): { code: string; message: string } {
  if (error instanceof ProtocolError) {
    return { code: error.code, message: error.message };
  }
  const message = error instanceof Error ? error.message : "handler error";
  return { code: "handler_error", message };
}

/** Probe helper used by lifecycle commands. */
export async function fetchDaemonStatus(
  socketPath: string,
): Promise<{ reachable: true; status: DaemonStatusResult } | { reachable: false }> {
  try {
    const response = await callDaemon({ id: "status", method: "status" }, { socketPath });
    if (!response.ok || !isStatusResult(response.result)) {
      return { reachable: false };
    }
    return { reachable: true, status: response.result };
  } catch {
    return { reachable: false };
  }
}

function isStatusResult(value: unknown): value is DaemonStatusResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "pid" in value &&
    typeof value.pid === "number" &&
    "socketPath" in value &&
    typeof value.socketPath === "string" &&
    "activeInvocationRunIds" in value &&
    Array.isArray(value.activeInvocationRunIds)
  );
}

if (import.meta.main) {
  const socketPath = readServeSocketPath(process.argv.slice(2));
  await runDaemonServe({ socketPath });
}

function readServeSocketPath(argv: readonly string[]): string {
  let jarvisRoot: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--jarvis-root") {
      jarvisRoot = argv[index + 1];
    }
  }
  if (jarvisRoot !== undefined) {
    return daemonSocketPath(jarvisRoot);
  }
  throw new Error("daemon serve requires --jarvis-root");
}
