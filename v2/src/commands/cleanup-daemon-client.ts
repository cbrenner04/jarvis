import type { CliDeps } from "../cli/deps.ts";
import { createStaleResetDaemonClient, type DaemonClient } from "./cleanup.ts";

export const CLEANUP_ABSENT_DAEMON_MESSAGE = "No daemon is listening for this build; run `jarvis daemon start`.\n";

export function formatCleanupAbsentDaemonMessage(): string {
  return CLEANUP_ABSENT_DAEMON_MESSAGE;
}

let invertCleanupAbsentSocketContinueForTest = false;

export function setInvertCleanupAbsentSocketContinueForTest(value: boolean): void {
  invertCleanupAbsentSocketContinueForTest = value;
}

export function invertCleanupAbsentSocketContinueForTestEnabled(): boolean {
  return invertCleanupAbsentSocketContinueForTest;
}

export type CleanupDaemonClientConnectResult = {
  client: DaemonClient;
  hadReachableDaemon: boolean;
};

function mergeDaemonClients(clients: readonly DaemonClient[]): DaemonClient {
  const merged = async (project: string, branch: string) => {
    const runs: { isLive: boolean }[] = [];
    let anyOk = false;
    let lastError: unknown;
    for (const client of clients) {
      try {
        runs.push(...(await client(project, branch)));
        anyOk = true;
      } catch (error) {
        lastError = error;
      }
    }
    if (!anyOk) throw lastError ?? new Error("Daemon unreachable");
    return runs;
  };
  const daemonClient = merged as DaemonClient;
  daemonClient.checkWorkflowStartClaim = async (project, branch) => {
    let lastError: unknown;
    for (const client of clients) {
      const probe = client.checkWorkflowStartClaim;
      if (probe === undefined) continue;
      try {
        return await probe(project, branch);
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError !== undefined) throw lastError;
    return { status: "free" };
  };
  return daemonClient;
}

export async function connectCleanupDaemonClient(deps: CliDeps): Promise<CleanupDaemonClientConnectResult> {
  const discovered = await (deps.socketDiscovery ?? (async () => []))();
  const socketPaths = [...new Set([...discovered, deps.socketPath])].sort();

  const liveClients: DaemonClient[] = [];
  for (const socketPath of socketPaths) {
    try {
      const ipc = await deps.connectIpcClient(socketPath);
      liveClients.push(createStaleResetDaemonClient(ipc));
    } catch {
      // skip unreachable sockets
    }
  }

  if (liveClients.length === 0) {
    const absentClient: DaemonClient = async () => {
      throw new Error("Daemon unreachable");
    };
    return { client: absentClient, hadReachableDaemon: false };
  }

  if (liveClients.length === 1) {
    const [onlyClient] = liveClients;
    if (onlyClient === undefined) {
      const absentClient: DaemonClient = async () => {
        throw new Error("Daemon unreachable");
      };
      return { client: absentClient, hadReachableDaemon: false };
    }
    return { client: onlyClient, hadReachableDaemon: true };
  }

  return { client: mergeDaemonClients(liveClients), hadReachableDaemon: true };
}
