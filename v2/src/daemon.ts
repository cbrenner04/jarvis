import { type IpcServer, type RpcHandler, startIpcServer } from "./ipc/server";
import { executeWriteLoop, type WriteLoopInput } from "./write-loop.ts";
import { openStateStore, type StateStore } from "./state-store.ts";
import { getExternalWorktreePath } from "./external-worktree.ts";

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

export async function startDaemon(socketPath: string, stateStore?: StateStore): Promise<void> {
  const _registry = new WorktreeOwnershipRegistry();
  const activeRuns = new Map<string, ActiveRun>();
  const store = stateStore ?? openStateStore();
  let shutdownRequested = false;

  const keyString = (key: OwnershipKey): string => `${key.project}:${key.branch}`;

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
    const ks = keyString(key);
    activeRuns.set(ks, { runId, key, abortController });

    // Claim the worktree
    _registry.claim(key, { runId, worktreePath });

    // Spawn the loop in the background, not awaited
    (async () => {
      try {
        await executeWriteLoop({
          ...input,
          stateStore: store,
          signal: abortController.signal,
        });
      } finally {
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

  const handlers: Record<string, RpcHandler> = {
    health: healthHandler,
    status: statusHandler,
    shutdown: shutdownHandler,
    start: startHandler,
    list: listHandler,
  };

  let server: IpcServer;

  try {
    server = await startIpcServer(socketPath, handlers);
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
