import { discoverLiveDaemonSockets } from "../daemon/live-daemon-socket-discovery.ts";
import { RpcConnectionError } from "../ipc/rpc-errors.ts";
import { type ConnectTuiDaemonOptions, connectTuiDaemon, type TuiDaemonClient } from "./tui-daemon-client.ts";
import { openInkLogFollow } from "./tui-ink-log-follow.tsx";
import { formatLogFollowLine } from "./tui-log-follow-lines.ts";
import type { RunTuiLogFollowDeps, TuiLogFollowSession } from "./tui-log-follow-types.ts";
import { connectTuiLogTail } from "./tui-log-tail-client.ts";

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
  const retryConfig = deps.tailRetry;
  const maxRetries = retryConfig?.maxAttempts ?? 5;
  const initialDelay = retryConfig?.initialDelayMs ?? 100;
  const maxDelay = retryConfig?.maxDelayMs ?? 2000;

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

  let session: TuiLogFollowSession | undefined;
  let tail: Awaited<ReturnType<typeof connectTuiLogTail>> | undefined;
  let quitting = false;
  let exitCode = 0;
  let highestSeq = 0;

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
    session = await openLogFollowSession(deps, quit);
    const activeSession = session;

    const consume = (async (): Promise<void> => {
      let retryAttempt = 0;

      while (true) {
        try {
          tail = await connectFn(runId, { socketPath, afterSeq: highestSeq });
        } catch (error) {
          if (error instanceof RpcConnectionError) {
            if (retryAttempt === 0) {
              // Initial open failure.
              await Promise.resolve(activeSession.showFeedback({ kind: "unavailable" }));
              exitCode = 1;
              return;
            }
            // Mid-stream reconnect after exhausting retries.
            if (retryAttempt >= maxRetries) {
              if (!quitting) {
                await Promise.resolve(
                  activeSession.showFeedback({ kind: "rpc-error", code: "tail_resume_exhausted", message: error.message }),
                );
                exitCode = 1;
              }
              return;
            }
            // Retry with backoff.
            const delayMs = Math.min(initialDelay * Math.pow(2, retryAttempt - 1), maxDelay);
            if (quitting) {
              return;
            }
            await delay(delayMs, quitPromise);
            if (quitting) {
              return;
            }
            retryAttempt += 1;
            continue;
          }
          throw error;
        }

        const currentTail = tail;
        try {
          for await (const record of currentTail.records()) {
            highestSeq = Math.max(highestSeq, record.seq);
            await Promise.resolve(activeSession.appendLine(formatLogFollowLine(record)));
          }
          // Benign stream end.
          currentTail.close();
          return;
        } catch (error) {
          currentTail.close();
          if (error instanceof RpcConnectionError) {
            if (quitting) {
              return;
            }
            if (retryAttempt >= maxRetries) {
              await Promise.resolve(
                activeSession.showFeedback({ kind: "rpc-error", code: "tail_resume_exhausted", message: error.message }),
              );
              exitCode = 1;
              return;
            }
            // Retry with backoff.
            const delayMs = Math.min(initialDelay * Math.pow(2, retryAttempt), maxDelay);
            await delay(delayMs, quitPromise);
            if (quitting) {
              return;
            }
            retryAttempt += 1;
            continue;
          }
          throw error;
        }
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
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function delay(ms: number, quitSignal: Promise<void>): Promise<void> {
  const delayPromise = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    quitSignal.finally(() => clearTimeout(timer));
  });
  await Promise.race([delayPromise, quitSignal]);
}
