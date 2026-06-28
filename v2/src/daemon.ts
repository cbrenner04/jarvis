import { homedir } from "node:os";
import { join } from "node:path";
import { type IpcServer, type RpcHandler, type StreamHandler, startIpcServer } from "./ipc/server";
import { executeWriteLoop, type WriteLoopInput } from "./write-loop.ts";
import { openStateStore, type StateStore } from "./state-store.ts";
import { getExternalWorktreePath } from "./external-worktree.ts";
import { openLogReader, openLogSink, type LogReader } from "./log-stream.ts";

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

export class WorktreeOwnershipRegistry {
  private registry = new Map<string, WorktreeOwnership>();

  private keyString(key: OwnershipKey): string {
    return `${key.project}:${key.branch}`;
  }

  claim(key: OwnershipKey, ownership: WorktreeOwnership): void {
    const ks = this.keyString(key);
    if (this.registry.has(ks)) {
      throw new DaemonDoubleClaimError(key);
    }
    this.registry.set(ks, ownership);
  }

  release(key: OwnershipKey): void {
    const ks = this.keyString(key);
    this.registry.delete(ks);
  }

  get(key: OwnershipKey): WorktreeOwnership | undefined {
    return this.registry.get(this.keyString(key));
  }

  isClaimed(key: OwnershipKey): boolean {
    return this.registry.has(this.keyString(key));
  }
}

export async function startDaemon(socketPath: string, stateStore?: StateStore, logReader?: LogReader): Promise<void> {
  const _registry = new WorktreeOwnershipRegistry();
  const activeRuns = new Map<string, ActiveRun>();
  const store = stateStore ?? openStateStore();
  const logsPath = join(homedir(), ".jarvis", "state", "logs.jsonl");
  const logReaderInstance = logReader ?? openLogReader(logsPath);
  let shutdownRequested = false;

  const keyString = (key: OwnershipKey): string => `${key.project}:${key.branch}`;

  const tailStreamHandler: StreamHandler = async (streamId, payload, onData, onClose, signal) => {
    const params = payload as any;
    if (!params || typeof params.runId !== "string") {
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

  const startHandler: RpcHandler = (frame) => {
    const params = frame.params as any;
    if (!params || !params.input) {
      return { kind: "error", code: "invalid_params", message: "Missing input" };
    }

    const input = params.input as WriteLoopInput;
    const key: OwnershipKey = {
      project: input.worktree.projectName,
      branch: input.worktree.branchName,
    };

    // Check single in-flight run guard
    if (activeRuns.size > 0) {
      return {
        kind: "error",
        code: "run_in_progress",
        message: "A run is already in progress; at most one in-flight run globally",
      };
    }

    // Check per-(project, branch) guard
    if (_registry.isClaimed(key)) {
      return {
        kind: "error",
        code: "worktree_claimed",
        message: `Worktree already claimed for project=${key.project}, branch=${key.branch}`,
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

    const abortController = new AbortController();
    const pauseController = new AbortController();
    const ks = keyString(key);
    activeRuns.set(ks, { runId, key, abortController, pauseController });

    // Claim the worktree
    _registry.claim(key, { runId, worktreePath });

    // Spawn the loop in the background, not awaited
    (async () => {
      const logSink = openLogSink(logsPath);
      try {
        await executeWriteLoop({
          ...input,
          stateStore: store,
          logSink,
          signal: abortController.signal,
          pauseSignal: pauseController.signal,
        });
      } finally {
        logSink.close();
        // Release registration when settled
        activeRuns.delete(ks);
        _registry.release(key);
      }
    })();

    return { kind: "response", result: { runId } };
  };

  const listHandler: RpcHandler = () => {
    const durableRuns = store.listRuns();

    const runList = durableRuns.map((run) => {
      const ks = keyString({ project: run.project, branch: run.branch });
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
    const params = frame.params as any;
    if (!params || !params.runId) {
      return { kind: "error", code: "invalid_params", message: "Missing runId" };
    }

    const runId = params.runId as string;
    const run = store.loadRun(runId);
    if (!run) {
      return { kind: "error", code: "unknown_run", message: `Run ${runId} not found` };
    }

    const ks = keyString({ project: run.project, branch: run.branch });
    const activeRun = activeRuns.get(ks);
    if (activeRun && activeRun.runId === runId) {
      activeRun.pauseController.abort();
      return { kind: "response", result: { ok: true } };
    }

    return { kind: "error", code: "run_not_active", message: `Run ${runId} is not currently active` };
  };

  const killHandler: RpcHandler = (frame) => {
    const params = frame.params as any;
    if (!params || !params.runId) {
      return { kind: "error", code: "invalid_params", message: "Missing runId" };
    }

    const runId = params.runId as string;
    const run = store.loadRun(runId);
    if (!run) {
      return { kind: "error", code: "unknown_run", message: `Run ${runId} not found` };
    }

    const ks = keyString({ project: run.project, branch: run.branch });
    const activeRun = activeRuns.get(ks);
    if (activeRun && activeRun.runId === runId) {
      activeRun.abortController.abort();
      store.setRunStatus(runId, "killed");
      return { kind: "response", result: { ok: true } };
    }

    return { kind: "error", code: "run_not_active", message: `Run ${runId} is not currently active` };
  };

  const resumeHandler: RpcHandler = (frame) => {
    const params = frame.params as any;
    if (!params || !params.runId) {
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

    // Check single in-flight run guard
    if (activeRuns.size > 0) {
      return {
        kind: "error",
        code: "run_in_progress",
        message: "A run is already in progress; at most one in-flight run globally",
      };
    }

    // Check per-(project, branch) guard
    if (_registry.isClaimed(key)) {
      return {
        kind: "error",
        code: "worktree_claimed",
        message: `Worktree already claimed for project=${key.project}, branch=${key.branch}`,
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

    const abortController = new AbortController();
    const pauseController = new AbortController();
    const ks = keyString(key);
    activeRuns.set(ks, { runId, key, abortController, pauseController });

    // Claim the worktree
    _registry.claim(key, { runId, worktreePath: run.worktreePath });

    // Spawn the loop in the background, not awaited
    (async () => {
      const logSink = openLogSink(logsPath);
      try {
        await executeWriteLoop({
          ...input,
          stateStore: store,
          logSink,
          signal: abortController.signal,
          pauseSignal: pauseController.signal,
        });
      } finally {
        logSink.close();
        // Release registration when settled
        activeRuns.delete(ks);
        _registry.release(key);
      }
    })();

    return { kind: "response", result: { ok: true } };
  };

  const handlers: Record<string, RpcHandler> = {
    health: healthHandler,
    status: statusHandler,
    shutdown: shutdownHandler,
    start: startHandler,
    list: listHandler,
    pause: pauseHandler,
    kill: killHandler,
    resume: resumeHandler,
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
            (logReaderInstance as any).close?.();
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
