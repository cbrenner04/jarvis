import { type IpcServer, type RpcHandler, startIpcServer } from "./ipc/server";

const socketPathEnv = process.env.DAEMON_SOCKET_PATH;
if (!socketPathEnv) {
  console.error("DAEMON_SOCKET_PATH environment variable required");
  process.exit(1);
}
const socketPath = socketPathEnv;

export type WorktreeOwnership = {
  runId: string;
  worktreePath: string;
};

export type OwnershipKey = {
  project: string;
  branch: string;
};

export class DaemonDoubleClaimError extends Error {
  constructor(key: OwnershipKey) {
    super(`Worktree already claimed for project=${key.project}, branch=${key.branch}`);
    this.name = "DaemonDoubleClaimError";
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

async function main(): Promise<void> {
  const _registry = new WorktreeOwnershipRegistry();
  let shutdownRequested = false;

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

main().catch((err) => {
  console.error("Fatal daemon error:", err);
  process.exit(1);
});
