import { homedir } from "node:os";
import { join } from "node:path";
import { createAgentBindings } from "../../shared/invocation/agents.ts";
import { getExternalWorktreePath } from "./external-worktree.ts";
import { type IpcServer, type RpcHandler, type StreamHandler, startIpcServer } from "./ipc/server";
import { type LogReader, openLogReader, openLogSink } from "./log-stream.ts";
import { openStateStore, type StateStore } from "./state-store.ts";
import { executeWriteLoop, type WriteLoopInput } from "./write-loop.ts";

export type WorktreeOwnership = {
  runId: string;
  worktreePath: string;
};

export type OwnershipKey = {
  project: string;
  branch: string;
};

export type ActiveRun = {
  runId: string;
  key: OwnershipKey;
  abortController: AbortController;
  pauseController: AbortController;
};

export class DaemonDoubleClaimError extends Error {
  constructor(key: OwnershipKey) {
    super(`Worktree already claimed for project=${key.project}, branch=${key.branch}`);
    this.name = "DaemonDoubleClaimError";
  }
}

export class DaemonRunRejectedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "DaemonRunRejectedError";
  }
}

function ownershipKeyString(key: OwnershipKey): string {
  return `${key.project}:${key.branch}`;
}

export class WorktreeOwnershipRegistry {
  private registry = new Map<string, WorktreeOwnership>();

  claim(key: OwnershipKey, ownership: WorktreeOwnership): void {
    const ks = ownershipKeyString(key);
    if (this.registry.has(ks)) {
      throw new DaemonDoubleClaimError(key);
    }
    this.registry.set(ks, ownership);
  }

  release(key: OwnershipKey): void {
    this.registry.delete(ownershipKeyString(key));
  }

  get(key: OwnershipKey): WorktreeOwnership | undefined {
    return this.registry.get(ownershipKeyString(key));
  }

  isClaimed(key: OwnershipKey): boolean {
    return this.registry.has(ownershipKeyString(key));
  }
}

function normalizeBindings(input: WriteLoopInput): WriteLoopInput {
  const bindingIds = input.bindings
    .map((binding) => {
      if (typeof binding !== "object" || binding === null) return null;
      const id = "id" in binding ? binding.id : undefined;
      return typeof id === "string" ? id : null;
    })
    .filter((id): id is string => id !== null);

  const hasLiveBindings = input.bindings.every(
    (binding) =>
      typeof binding === "object" && binding !== null && "invoke" in binding && typeof binding.invoke === "function",
  );

  if (hasLiveBindings || bindingIds.length === 0) {
    return input;
  }

  return {
    ...input,
    bindings: createAgentBindings(bindingIds),
  };
}

/**
 * Injectable dependencies for {@link createRunControlHandlers}.
 * Factory owns claim/release and fire-and-forget spawn; `writeLoopExecutor` runs the loop body only
 * (log-sink open/close stays in {@link startDaemon}'s production wrapper).
 */
export type RunControlHandlerDeps = {
  stateStore: StateStore;
  writeLoopExecutor: (input: WriteLoopInput, signal: AbortSignal, pauseSignal: AbortSignal) => Promise<void>;
};

/**
 * Builds `start`/`list`/`pause`/`resume`/`kill` RPC handlers with per-instance
 * worktree ownership and in-flight run tracking. Spawns the write loop in the
 * background; settlement always releases registry and active-run entries.
 */
export function createRunControlHandlers(deps: RunControlHandlerDeps) {
  const _registry = new WorktreeOwnershipRegistry();
  const activeRuns = new Map<string, ActiveRun>();
  const { stateStore: store, writeLoopExecutor } = deps;

  const spawnWriteLoop = (key: OwnershipKey, runId: string, worktreePath: string, input: WriteLoopInput): void => {
    const ks = ownershipKeyString(key);
    const abortController = new AbortController();
    const pauseController = new AbortController();
    activeRuns.set(ks, { runId, key, abortController, pauseController });

    _registry.claim(key, { runId, worktreePath });

    (async () => {
      try {
        await writeLoopExecutor(input, abortController.signal, pauseController.signal);
      } finally {
        activeRuns.delete(ks);
        _registry.release(key);
      }
    })();
  };

  const startHandler: RpcHandler = (frame) => {
    const params = frame.params as { input?: WriteLoopInput } | undefined;
    if (!params?.input) {
      return { kind: "error", code: "invalid_params", message: "Missing input" };
    }

    const input = normalizeBindings(params.input as WriteLoopInput);
    const key: OwnershipKey = {
      project: input.worktree.projectName,
      branch: input.worktree.branchName,
    };

    // Check per-(project, branch) guard first (more specific than the global guard).
    if (_registry.isClaimed(key)) {
      return {
        kind: "error",
        code: "worktree_claimed",
        message: `Worktree already claimed for project=${key.project}, branch=${key.branch}`,
      };
    }

    // Check single in-flight run guard (global; a different (project, branch) still rejects).
    if (activeRuns.size > 0) {
      return {
        kind: "error",
        code: "run_in_progress",
        message: "A run is already in progress; at most one in-flight run globally",
      };
    }

    const worktreePath = getExternalWorktreePath(input.worktree);
    const runId = store.createRun({
      project: key.project,
      specRef: input.worktree.baseRef,
      worktreePath,
      branch: key.branch,
      specPath: input.specPath,
    });

    spawnWriteLoop(key, runId, worktreePath, input);

    return { kind: "response", result: { runId } };
  };

  const listHandler: RpcHandler = () => {
    const durableRuns = store.listRuns();

    const runList = durableRuns.map((run) => {
      const ks = ownershipKeyString({ project: run.project, branch: run.branch });
      const isLive = activeRuns.has(ks);
      return {
        runId: run.id,
        project: run.project,
        branch: run.branch,
        status: run.status,
        isLive,
      };
    });

    return { kind: "response", result: { runs: runList } };
  };

  const pauseHandler: RpcHandler = (frame) => {
    const params = frame.params as { runId?: string } | undefined;
    if (!params?.runId) {
      return { kind: "error", code: "invalid_params", message: "Missing runId" };
    }

    const runId = params.runId as string;
    const run = store.loadRun(runId);
    if (!run) {
      return { kind: "error", code: "unknown_run", message: `Run ${runId} not found` };
    }

    const ks = ownershipKeyString({ project: run.project, branch: run.branch });
    const activeRun = activeRuns.get(ks);
    if (activeRun && activeRun.runId === runId) {
      activeRun.pauseController.abort();
      return { kind: "response", result: { ok: true } };
    }

    return { kind: "error", code: "run_not_active", message: `Run ${runId} is not currently active` };
  };

  const killHandler: RpcHandler = (frame) => {
    const params = frame.params as { runId?: string } | undefined;
    if (!params?.runId) {
      return { kind: "error", code: "invalid_params", message: "Missing runId" };
    }

    const runId = params.runId as string;
    const run = store.loadRun(runId);
    if (!run) {
      return { kind: "error", code: "unknown_run", message: `Run ${runId} not found` };
    }

    const ks = ownershipKeyString({ project: run.project, branch: run.branch });
    const activeRun = activeRuns.get(ks);
    if (activeRun && activeRun.runId === runId) {
      activeRun.abortController.abort();
      store.setRunStatus(runId, "killed");
      return { kind: "response", result: { ok: true } };
    }

    return { kind: "error", code: "run_not_active", message: `Run ${runId} is not currently active` };
  };

  const resumeHandler: RpcHandler = (frame) => {
    const params = frame.params as { runId?: string } | undefined;
    if (!params?.runId) {
      return { kind: "error", code: "invalid_params", message: "Missing runId" };
    }

    const runId = params.runId as string;
    const run = store.loadRun(runId);
    if (!run) {
      return { kind: "error", code: "unknown_run", message: `Run ${runId} not found` };
    }

    // Reject terminal statuses
    if (run.status === "completed" || run.status === "failed" || run.status === "blocked") {
      return { kind: "error", code: "terminal_run", message: `Cannot resume a ${run.status} run` };
    }

    const key: OwnershipKey = { project: run.project, branch: run.branch };

    // Check per-(project, branch) guard first (more specific than the global guard).
    if (_registry.isClaimed(key)) {
      return {
        kind: "error",
        code: "worktree_claimed",
        message: `Worktree already claimed for project=${key.project}, branch=${key.branch}`,
      };
    }

    // Check single in-flight run guard (global; a different (project, branch) still rejects).
    if (activeRuns.size > 0) {
      return {
        kind: "error",
        code: "run_in_progress",
        message: "A run is already in progress; at most one in-flight run globally",
      };
    }

    // Reconstruct WriteLoopInput from the run and re-invoke executeWriteLoop
    const input: WriteLoopInput = {
      worktree: {
        projectRoot: run.worktreePath,
        projectName: run.project,
        branchName: run.branch,
        baseRef: run.specRef,
      },
      specPath: run.specPath,
      stepRules: "", // These should be reconstructed from the calling context
      expectedArtifactPath: "", // These should be reconstructed from the calling context
      bindings: [],
    };

    spawnWriteLoop(key, runId, run.worktreePath, input);

    return { kind: "response", result: { ok: true } };
  };

  return {
    start: startHandler,
    list: listHandler,
    pause: pauseHandler,
    resume: resumeHandler,
    kill: killHandler,
  };
}

export async function startDaemon(socketPath: string, stateStore?: StateStore, logReader?: LogReader): Promise<void> {
  const store = stateStore ?? openStateStore();
  const logsPath = join(homedir(), ".jarvis", "state", "logs.jsonl");
  const logReaderInstance = logReader ?? openLogReader(logsPath);
  let shutdownRequested = false;

  const writeLoopExecutor = async (input: WriteLoopInput, signal: AbortSignal, pauseSignal: AbortSignal) => {
    const logSink = openLogSink(logsPath);
    try {
      await executeWriteLoop({
        ...input,
        stateStore: store,
        logSink,
        signal,
        pauseSignal,
      });
    } finally {
      logSink.close();
    }
  };

  const tailStreamHandler: StreamHandler = async (_streamId, payload, onData, onClose, signal) => {
    const params = typeof payload === "string" && payload ? JSON.parse(payload) : payload;
    if (!params?.runId || typeof params.runId !== "string") {
      onClose();
      return;
    }

    const runId = params.runId as string;
    const run = store.loadRun(runId);
    if (!run) {
      onClose();
      return;
    }

    try {
      for await (const record of logReaderInstance.follow(runId, signal)) {
        if (signal.aborted) break;
        onData(record);
      }
    } finally {
      onClose();
    }
  };

  const healthHandler: RpcHandler = () => {
    return { kind: "response", result: { ok: true } };
  };

  const statusHandler: RpcHandler = () => {
    return { kind: "response", result: { state: "running" } };
  };

  const shutdownHandler: RpcHandler = () => {
    shutdownRequested = true;
    return { kind: "response", result: { ok: true } };
  };

  const handlers: Record<string, RpcHandler> = {
    health: healthHandler,
    status: statusHandler,
    shutdown: shutdownHandler,
    ...createRunControlHandlers({ stateStore: store, writeLoopExecutor }),
  };

  let server: IpcServer;

  try {
    server = await startIpcServer(socketPath, handlers, tailStreamHandler);
  } catch (err) {
    console.error(`Failed to start IPC server on ${socketPath}:`, err);
    process.exit(1);
  }

  const signalHandler = () => {
    shutdownRequested = true;
  };

  process.on("SIGTERM", signalHandler);
  process.on("SIGINT", signalHandler);

  const checkShutdown = setInterval(() => {
    if (shutdownRequested) {
      clearInterval(checkShutdown);
      (async () => {
        try {
          await server.close();
          if (!logReader) {
            const closeable = logReaderInstance as { close?: () => void };
            closeable.close?.();
          }
          if (!stateStore) {
            store.close();
          }
          process.exit(0);
        } catch (err) {
          console.error("Error during shutdown:", err);
          process.exit(1);
        }
      })();
    }
  }, 100);

  console.error(`Daemon running on socket ${socketPath} with PID ${process.pid}`);
}
