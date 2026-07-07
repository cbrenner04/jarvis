import { TuiDaemonConnectionError } from "./tui-daemon-errors.ts";
import { showTuiInkFeedback } from "./tui-ink-feedback.tsx";
import { openInkLogFollow } from "./tui-ink-log-follow.tsx";
import { formatLogFollowLine } from "./tui-log-follow-lines.ts";
import type { RunTuiLogFollowDeps, TuiLogFollowSession } from "./tui-log-follow-types.ts";
import { connectTuiLogTail } from "./tui-log-tail-client.ts";
import type { TuiViewState } from "./tui-monitor-types.ts";

function connectionErrorFeedback(error: TuiDaemonConnectionError): TuiViewState {
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

/** Connect, tail structured logs for one run, and render until quit or benign stream end. */
export async function runTuiLogFollow(runId: string, deps?: RunTuiLogFollowDeps): Promise<number> {
  const resolved = deps ?? {};
  const connectFn = resolved.connectTuiLogTail ?? connectTuiLogTail;
  const connectOptions = resolved.socketPath !== undefined ? { socketPath: resolved.socketPath } : undefined;

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
    if (error instanceof TuiDaemonConnectionError) {
      await presentFeedback({ kind: "unavailable" }, resolved);
      return 1;
    }
    throw error;
  }

  try {
    session = await openLogFollowSession(resolved, quit);
    const activeTail = tail;
    const activeSession = session;

    const consume = (async (): Promise<void> => {
      try {
        for await (const record of activeTail.records()) {
          await Promise.resolve(activeSession.appendLine(formatLogFollowLine(record)));
        }
      } catch (error) {
        if (error instanceof TuiDaemonConnectionError) {
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
