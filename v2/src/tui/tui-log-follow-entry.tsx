import { discoverLiveDaemonSockets } from "../daemon/live-daemon-socket-discovery.ts";
import { RpcConnectionError } from "../ipc/rpc-errors.ts";
import { connectTuiDaemon, type ConnectTuiDaemonOptions, type TuiDaemonClient } from "./tui-daemon-client.ts";
import { showTuiInkFeedback } from "./tui-ink-feedback.tsx";
import { openInkLogFollow } from "./tui-ink-log-follow.tsx";
import { formatLogFollowLine } from "./tui-log-follow-lines.ts";
import type { RunTuiLogFollowDeps, TuiLogFollowSession } from "./tui-log-follow-types.ts";
import { connectTuiLogTail } from "./tui-log-tail-client.ts";
import type { TuiViewState } from "./tui-monitor-types.ts";

function connectionErrorFeedback(error: RpcConnectionError): TuiViewState {
  return { kind: "rpc-error", code: "daemon_error", message: error.message };
}

async function presentFeedback(state: TuiViewState, deps: RunTuiLogFollowDeps): Promise<void> {
  if (deps.viewHost !== undefined) {
    await Promise.resolve(deps.viewHost.show(state));
    return;
  }
  await showTuiInkFeedback(state, deps.inkRender);
}

async function openLogFollowSession(deps: RunTuiLogFollowDeps, quit: () => void): Promise<TuiLogFollowSession> {
  if (deps.viewHost !== undefined) {
    return deps.viewHost.openLogFollow({ quit });
  }
  return openInkLogFollow({ quit }, deps.inkRender);
}

async function resolveOwningSocket(
  runId: string,
  sockets: string[],
  connectFn: (options: ConnectTuiDaemonOptions) => Promise<TuiDaemonClient>,
): Promise<string | undefined> {
  // Prefer a live owner; fall back to the first non-live match if no live owner is found.
  let fallbackSocket: string | undefined;

  for (const socketPath of sockets) {
    try {
      const client = await connectFn({ socketPath });
      try {
        const result = await client.list();
        const runRow = result.runs.find((r) => r.runId === runId);
        if (runRow?.isLive) {
          return socketPath;
        }
        if (runRow && fallbackSocket === undefined) {
          fallbackSocket = socketPath;
        }
      } finally {
        client.close();
      }
    } catch {
      // Skip sockets that fail during owner lookup.
    }
  }

  return fallbackSocket;
}

/** Connect, tail structured logs for one run, and render until quit or benign stream end. */
export async function runTuiLogFollow(runId: string, deps: RunTuiLogFollowDeps): Promise<number> {
  const connectFn = deps.connectTuiLogTail ?? connectTuiLogTail;
  const discoverFn = deps.socketDiscovery ?? discoverLiveDaemonSockets;
  const daemonConnectFn = deps.connectTuiDaemon ?? connectTuiDaemon;

  let socketPath = deps.socketPath;
  try {
    const allSockets = new Set(await discoverFn());
    allSockets.add(deps.socketPath);
    const owningSocket = await resolveOwningSocket(runId, Array.from(allSockets), daemonConnectFn);
    if (owningSocket !== undefined) {
      socketPath = owningSocket;
    }
  } catch {
    // Discovery failure falls back to the invoking socket.
  }

  const connectOptions = { socketPath };

  let tail: Awaited<ReturnType<typeof connectTuiLogTail>> | undefined;
  let session: TuiLogFollowSession | undefined;
  let quitting = false;
  let exitCode = 0;

  let resolveQuit!: () => void;
  const quitPromise = new Promise<void>((resolve) => {
    resolveQuit = resolve;
  });
  const streamDone = deferred<void>();
  const consumeSettlement: { error?: unknown } = {};

  const quit = (): void => {
    quitting = true;
    tail?.close();
    resolveQuit();
  };

  try {
    tail = await connectFn(runId, connectOptions);
  } catch (error) {
    if (error instanceof RpcConnectionError) {
      await presentFeedback({ kind: "unavailable" }, deps);
      return 1;
    }
    throw error;
  }

  try {
    session = await openLogFollowSession(deps, quit);
    const activeTail = tail;
    const activeSession = session;

    const consume = (async (): Promise<void> => {
      try {
        for await (const record of activeTail.records()) {
          await Promise.resolve(activeSession.appendLine(formatLogFollowLine(record)));
        }
      } catch (error) {
        if (error instanceof RpcConnectionError) {
          if (!quitting) {
            await Promise.resolve(activeSession.showFeedback(connectionErrorFeedback(error)));
            exitCode = 1;
          }
          return;
        }
        throw error;
      }
    })();

    void consume
      .catch((error: unknown) => {
        consumeSettlement.error = error;
      })
      .finally(() => {
        streamDone.resolve();
      });

    await Promise.race([quitPromise, streamDone.promise]);
    if (consumeSettlement.error !== undefined) throw consumeSettlement.error;
    return exitCode;
  } finally {
    session?.close();
    tail?.close();
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}
