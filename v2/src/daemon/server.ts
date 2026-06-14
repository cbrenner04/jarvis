import { existsSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import {
  DAEMON_LOG_RUN_ID,
  defaultLogRepositoryPath,
  type LogFollowHandle,
  type LogRepository,
  openLogRepository,
} from "../log-repository.ts";
import { defaultStateStorePath, openStateStore, type StateStore } from "../state-store.ts";
import type { executeWriteLoop, WriteLoopInput } from "../write-loop.ts";
import { callDaemon, isDaemonReachable, removeStaleSocket } from "./client.ts";
import { daemonSocketPath, ensureJarvisRoot } from "./paths.ts";
import {
  type DaemonRequest,
  type DaemonResponse,
  type DaemonStreamFrame,
  encodeFrame,
  errorResponse,
  okResponse,
  ProtocolError,
  parseRequestLine,
} from "./protocol.ts";
import {
  OwnershipConflictError,
  parseRunStartParams,
  parseRunSteeringParams,
  RunManager,
  SteeringError,
} from "./run-manager.ts";

export type DaemonStatusResult = {
  pid: number;
  socketPath: string;
  activeInvocationRunIds: readonly string[];
};

export type DaemonHostOptions = {
  socketPath: string;
  pid?: number;
  logRepository?: LogRepository;
  stateStore?: StateStore;
  executeWriteLoop?: (input: WriteLoopInput) => Promise<Awaited<ReturnType<typeof executeWriteLoop>>>;
  createBindings?: (agentIds: readonly string[]) => readonly InvocationBinding[];
};

export type DaemonHost = {
  socketPath: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  waitUntilStopped(): Promise<void>;
  registerActiveInvocation(runId: string): void;
  unregisterActiveInvocation(runId: string): void;
  handleRequest(request: DaemonRequest): DaemonResponse;
  logRepository: LogRepository;
  stateStore: StateStore;
  runManager: RunManager;
};

/** Create a daemon host bound to a Unix socket. */
export function createDaemonHost(options: DaemonHostOptions): DaemonHost {
  const activeInvocationRunIds = new Set<string>();
  const pid = options.pid ?? process.pid;
  const jarvisRoot = dirnameForSocket(options.socketPath);
  const logRepository = options.logRepository ?? openLogRepository(defaultLogRepositoryPath(jarvisRoot));
  const stateStore = options.stateStore ?? openStateStore(defaultStateStorePath(jarvisRoot));
  const runManager = new RunManager({
    stateStore,
    logRepository,
    jarvisRoot,
    ...(options.executeWriteLoop !== undefined ? { executeWriteLoop: options.executeWriteLoop } : {}),
    ...(options.createBindings !== undefined ? { createBindings: options.createBindings } : {}),
    registerActiveInvocation: (runId) => {
      activeInvocationRunIds.add(runId);
    },
    unregisterActiveInvocation: (runId) => {
      activeInvocationRunIds.delete(runId);
    },
  });
  let server: Server | null = null;
  let shuttingDown = false;
  let stoppedResolve: (() => void) | null = null;
  const stopped = new Promise<void>((resolve) => {
    stoppedResolve = resolve;
  });

  const handleRequest = (request: DaemonRequest): DaemonResponse => {
    switch (request.method) {
      case "status":
        return okResponse(request.id, {
          pid,
          socketPath: options.socketPath,
          activeInvocationRunIds: [...activeInvocationRunIds],
        } satisfies DaemonStatusResult);
      case "stop":
        return handleStopRequest(request);
      case "log.tail":
        return errorResponse(request.id, {
          code: "streaming_method",
          message: "log.tail must be handled on the connection stream",
        });
      case "run.start":
        return handleRunStartRequest(request);
      case "run.list":
        return okResponse(request.id, runManager.list());
      case "run.pause":
      case "run.resume":
      case "run.kill":
        return handleSteeringRequest(request);
      default:
        return errorResponse(request.id, {
          code: "unknown_method",
          message: `unknown method: ${request.method}`,
        });
    }
  };

  const handleStopRequest = (request: DaemonRequest): DaemonResponse => {
    if (activeInvocationRunIds.size > 0) {
      return errorResponse(request.id, {
        code: "active_invocations",
        message: "daemon has active invocations",
        data: { activeRunIds: [...activeInvocationRunIds] },
      });
    }
    logRepository.append({
      runId: DAEMON_LOG_RUN_ID,
      level: "info",
      event: "daemon.stopping",
      data: { pid },
    });
    queueShutdown();
    return okResponse(request.id, { stopped: true });
  };

  const handleRunStartRequest = (request: DaemonRequest): DaemonResponse => {
    const parsed = parseRunStartParams(request.params);
    if (!parsed.ok) {
      return errorResponse(request.id, parsed.error);
    }
    try {
      return okResponse(request.id, runManager.start(parsed.value));
    } catch (error) {
      if (error instanceof OwnershipConflictError) {
        return errorResponse(request.id, {
          code: "ownership_conflict",
          message: error.message,
          data: {
            project: error.project,
            branch: error.branch,
            existingRunId: error.existingRunId,
          },
        });
      }
      return errorResponse(request.id, protocolError(error));
    }
  };

  const handleSteeringRequest = (request: DaemonRequest): DaemonResponse => {
    const parsed = parseRunSteeringParams(request.params, request.method);
    if (!parsed.ok) {
      return errorResponse(request.id, parsed.error);
    }
    try {
      const result =
        request.method === "run.pause"
          ? runManager.pause(parsed.value.runId)
          : request.method === "run.resume"
            ? runManager.resume(parsed.value.runId)
            : runManager.kill(parsed.value.runId);
      return okResponse(request.id, result);
    } catch (error) {
      if (error instanceof SteeringError) {
        return errorResponse(request.id, { code: error.code, message: error.message });
      }
      return errorResponse(request.id, protocolError(error));
    }
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
    const tailHandles = new Set<LogFollowHandle>();

    const closeTails = (reason: "disconnected" | "slow_consumer") => {
      for (const handle of tailHandles) {
        handle.close();
      }
      tailHandles.clear();
      if (reason === "disconnected" && !socket.destroyed) {
        // Terminal responses for open tails are omitted when the client disconnects abruptly.
      }
    };

    socket.on("close", () => {
      closeTails("disconnected");
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        void dispatchLine(socket, line, tailHandles);
      }
    });
  };

  const dispatchLine = async (socket: Socket, line: string, tailHandles: Set<LogFollowHandle>): Promise<void> => {
    let request: DaemonRequest;
    try {
      request = parseRequestLine(line);
    } catch (error) {
      const requestId = extractRequestId(line) ?? "invalid";
      socket.write(encodeFrame(errorResponse(requestId, protocolError(error))));
      return;
    }

    if (request.method === "log.tail") {
      await handleLogTail(socket, request, tailHandles);
      return;
    }

    try {
      socket.write(encodeFrame(handleRequest(request)));
    } catch (error) {
      socket.write(encodeFrame(errorResponse(request.id, protocolError(error))));
    }
  };

  const handleLogTail = async (
    socket: Socket,
    request: DaemonRequest,
    tailHandles: Set<LogFollowHandle>,
  ): Promise<void> => {
    const params = parseLogTailParams(request.params);
    if (!params.ok) {
      socket.write(encodeFrame(errorResponse(request.id, params.error)));
      return;
    }

    const { runId, fromSeq } = params.value;
    const replayed = logRepository.listRecords(runId, fromSeq);
    for (const record of replayed) {
      if (!writeStreamFrame(socket, logRecordFrame(request.id, record))) {
        return;
      }
    }

    let follow: LogFollowHandle;
    const followOptions: { fromSeq?: number; onDropped: () => void } = {
      onDropped: () => {
        writeStreamFrame(socket, {
          kind: "stream",
          id: request.id,
          event: "log.close",
          data: { reason: "slow_consumer" },
        });
        socket.write(
          encodeFrame(
            okResponse(request.id, {
              closed: true,
              reason: "slow_consumer",
            }),
          ),
        );
        tailHandles.delete(follow);
      },
    };
    const lastReplayedSeq = replayed.at(-1)?.seq;
    if (lastReplayedSeq !== undefined) {
      followOptions.fromSeq = lastReplayedSeq;
    } else if (fromSeq !== undefined) {
      followOptions.fromSeq = fromSeq;
    }

    follow = logRepository.follow(
      runId,
      (record) => {
        if (!writeStreamFrame(socket, logRecordFrame(request.id, record))) {
          follow.close();
          tailHandles.delete(follow);
        }
      },
      followOptions,
    );
    tailHandles.add(follow);
  };

  return {
    socketPath: options.socketPath,
    logRepository,
    stateStore,
    runManager,
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
      logRepository.append({
        runId: DAEMON_LOG_RUN_ID,
        level: "info",
        event: "daemon.started",
        data: { pid, socketPath: options.socketPath },
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
  host.logRepository.close();
  host.stateStore.close();
}

function logRecordFrame(requestId: string, record: unknown): DaemonStreamFrame {
  return { kind: "stream", id: requestId, event: "log.record", data: record };
}

function writeStreamFrame(socket: Socket, frame: DaemonStreamFrame): boolean {
  if (socket.destroyed) return false;
  try {
    socket.write(encodeFrame(frame));
    return true;
  } catch {
    return false;
  }
}

function parseLogTailParams(
  params: unknown,
): { ok: true; value: { runId: string; fromSeq?: number } } | { ok: false; error: { code: string; message: string } } {
  if (typeof params !== "object" || params === null || typeof (params as { runId?: unknown }).runId !== "string") {
    return { ok: false, error: { code: "invalid_params", message: "log.tail requires string runId" } };
  }
  const runId = (params as { runId: string }).runId;
  const fromSeq = (params as { fromSeq?: unknown }).fromSeq;
  if (fromSeq !== undefined && (typeof fromSeq !== "number" || !Number.isInteger(fromSeq) || fromSeq < 0)) {
    return { ok: false, error: { code: "invalid_params", message: "fromSeq must be a non-negative integer" } };
  }
  return { ok: true, value: fromSeq === undefined ? { runId } : { runId, fromSeq } };
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
