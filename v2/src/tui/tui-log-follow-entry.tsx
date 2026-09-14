import { RpcConnectionError } from "../ipc/rpc-errors.ts";
import { connectTuiDaemon } from "./tui-daemon-client.ts";
import { openInkLogFollow } from "./tui-ink-log-follow.tsx";
import { formatLogFollowLine } from "./tui-log-follow-lines.ts";
import type { RunTuiLogFollowDeps, TuiLogFollowSession } from "./tui-log-follow-types.ts";
import { connectTuiLogTail } from "./tui-log-tail-client.ts";
import { type DaemonRevisionReadOutcome, decideTuiRevisionReexec } from "./tui-revision-follow.ts";
import {
  defaultResolveTuiRevision,
  performTuiRevisionReexec,
  readTuiReexecedForRevision,
} from "./tui-revision-reexec.ts";

async function openLogFollowSession(deps: RunTuiLogFollowDeps, quit: () => void): Promise<TuiLogFollowSession> {
  if (deps.viewHost !== undefined) {
    return deps.viewHost.openLogFollow({ quit });
  }
  return openInkLogFollow({ quit }, deps.inkRender);
}

/** Reads the daemon's `status` RPC over a fresh connection; a transport or wire failure reads as `{ kind: "failure" }`. */
function defaultReadTuiDaemonRevision(socketPath: string): () => Promise<DaemonRevisionReadOutcome> {
  return async () => {
    try {
      const client = await connectTuiDaemon({ socketPath });
      try {
        const result = await client.status();
        return { kind: "success", loadedRevision: result.loadedRevision };
      } finally {
        client.close();
      }
    } catch {
      return { kind: "failure" };
    }
  };
}

/** Explicit re-exec argv targeting `tui log <run-id>`, replacing this process's own argv tail. */
function tuiLogFollowReexecArgv(runId: string): readonly string[] {
  const nodeExecutable = process.argv[0];
  const scriptPath = process.argv[1];
  if (nodeExecutable === undefined || scriptPath === undefined) {
    throw new Error("cannot re-exec: process.argv is too short");
  }
  return [nodeExecutable, scriptPath, "tui", "log", runId];
}

/** Connect, tail structured logs for one run, and render until quit or benign stream end. */
export async function runTuiLogFollow(runId: string, deps: RunTuiLogFollowDeps): Promise<number> {
  const connectFn = deps.connectTuiLogTail ?? connectTuiLogTail;
  const retryConfig = deps.tailRetry;
  const maxRetries = retryConfig?.maxAttempts ?? 5;
  const initialDelay = retryConfig?.initialDelayMs ?? 100;
  const maxDelay = retryConfig?.maxDelayMs ?? 2000;
  const resolveRevisionFn = deps.resolveTuiRevision ?? defaultResolveTuiRevision;
  const reexecActionFn = deps.reexecTuiLogFollow ?? performTuiRevisionReexec;
  const readRevisionFn = deps.readTuiDaemonRevision ?? defaultReadTuiDaemonRevision(deps.socketPath);
  const tuiRevision = await resolveRevisionFn();

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

  // Follow the daemon's loaded revision at each connect attempt: a stable mismatch re-execs onto
  // current code instead of tailing stale code. Each check reads status twice back-to-back, since
  // there is no refresh timer to accumulate stability across separate check points.
  const checkRevisionReexec = async (): Promise<boolean> => {
    const previousRead = await readRevisionFn();
    const currentRead = await readRevisionFn();
    const decision = decideTuiRevisionReexec(
      tuiRevision,
      previousRead,
      currentRead,
      true,
      false,
      readTuiReexecedForRevision(process.env),
    );
    if (!decision.reexec) return false;
    await reexecActionFn({
      daemonRevision: decision.daemonRevision,
      carriedState: { selectedNodeId: null, expandedPipelineNodeIds: [] },
      argv: tuiLogFollowReexecArgv(runId),
      teardown: {
        closeMonitor: () => session?.close(),
        closeRefreshScheduler: () => {},
        closeDaemonClient: () => tail?.close(),
      },
    });
    return true;
  };

  try {
    session = await openLogFollowSession(deps, quit);
    const activeSession = session;

    const consume = (async (): Promise<void> => {
      let retryAttempt = 0;

      while (true) {
        if (await checkRevisionReexec()) {
          return;
        }
        try {
          tail = await connectFn(runId, { socketPath: deps.socketPath, afterSeq: highestSeq });
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
                  activeSession.showFeedback({
                    kind: "rpc-error",
                    code: "tail_resume_exhausted",
                    message: error.message,
                  }),
                );
                exitCode = 1;
              }
              return;
            }
            // Retry with backoff.
            const delayMs = Math.min(initialDelay * 2 ** (retryAttempt - 1), maxDelay);
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
                activeSession.showFeedback({
                  kind: "rpc-error",
                  code: "tail_resume_exhausted",
                  message: error.message,
                }),
              );
              exitCode = 1;
              return;
            }
            // Retry with backoff.
            const delayMs = Math.min(initialDelay * 2 ** retryAttempt, maxDelay);
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
