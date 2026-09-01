import type { StreamHandler } from "../ipc/server.ts";
import { FOLLOW_POLL_MS, type LogReader, type PersistedRecord } from "../persistence/log-stream.ts";
import { isTerminalRunStatus, type StateStore } from "../persistence/state-store.ts";

/**
 * Injectable dependencies for {@link createTailStreamHandler}.
 *
 * `loadRun` and `follow`/`onData` failures propagate to IPC as error `stream-end`.
 */
export type TailStreamHandlerDeps = {
  stateStore: StateStore;
  logReader: LogReader;
  /** Interval to re-check run status independent of `follow()` yields; defaults to `FOLLOW_POLL_MS`. */
  followStatusPollMs?: number;
};

/** Resolves after `ms`, or immediately once `signal` aborts (whichever comes first). */
function sleepOrAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    timer.unref?.();
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function parseTailStreamParams(
  payload: unknown,
): { runId: string; afterSeq: number; follow: boolean } | undefined {
  const params = typeof payload === "string" && payload ? JSON.parse(payload) : payload;
  if (typeof params !== "object" || params === null) return undefined;
  const runId = (params as { runId?: unknown }).runId;
  if (typeof runId !== "string") return undefined;
  const afterSeq = (params as { afterSeq?: unknown }).afterSeq;
  const parsedAfterSeq = typeof afterSeq === "number" && afterSeq >= 0 ? afterSeq : 0;
  const follow = (params as { follow?: unknown }).follow === true;
  return { runId, afterSeq: parsedAfterSeq, follow };
}

export async function streamRunLogRecords(
  deps: TailStreamHandlerDeps,
  runId: string,
  afterSeq: number,
  follow: boolean,
  onData: (record: PersistedRecord) => void,
  signal: AbortSignal,
): Promise<void> {
  const run = deps.stateStore.loadRun(runId);
  if (!run) return;

  const replay = deps.logReader.tail(runId);
  let subscribeSeq = afterSeq;
  for (const record of replay) {
    if (signal.aborted) return;
    if (record.seq <= afterSeq) continue;
    onData(record);
    subscribeSeq = record.seq;
  }

  if (!follow) return;

  const drainRemaining = () => {
    for (const record of deps.logReader.tail(runId)) {
      if (record.seq > subscribeSeq) {
        onData(record);
        subscribeSeq = record.seq;
      }
    }
  };

  let current = deps.stateStore.loadRun(runId) ?? run;
  if (isTerminalRunStatus(current.status)) {
    drainRemaining();
    return;
  }

  // followSignal aborts on either terminal settlement or the caller's own signal, so the
  // follow() consumer and the independent status poller below can both stop it early.
  const followSignal = new AbortController();
  const abortFollow = () => followSignal.abort();
  if (signal.aborted) abortFollow();
  else signal.addEventListener("abort", abortFollow, { once: true });

  const pollMs = deps.followStatusPollMs ?? FOLLOW_POLL_MS;
  // Re-reads status on a timer independent of record arrival, so a run that settles without
  // appending a further record (e.g. a kill) still closes the stream within a bounded interval.
  const statusPoll = (async () => {
    while (!followSignal.signal.aborted) {
      await sleepOrAbort(pollMs, followSignal.signal);
      if (followSignal.signal.aborted) return;
      current = deps.stateStore.loadRun(runId) ?? current;
      if (isTerminalRunStatus(current.status)) {
        abortFollow();
        return;
      }
    }
  })();

  try {
    for await (const record of deps.logReader.follow(runId, followSignal.signal)) {
      if (signal.aborted) break;
      if (record.seq > subscribeSeq) {
        onData(record);
        subscribeSeq = record.seq;
      }

      current = deps.stateStore.loadRun(runId) ?? current;
      if (isTerminalRunStatus(current.status)) {
        abortFollow();
        break;
      }
    }
  } finally {
    abortFollow();
    signal.removeEventListener("abort", abortFollow);
    await statusPoll;
  }

  if (!signal.aborted) drainRemaining();
}

/**
 * Tail-log stream handler factory for IPC `stream-open` on run logs.
 *
 * @param deps - {@link TailStreamHandlerDeps}
 * @throws N/A at factory call — returned handler may throw/reject on string-payload `JSON.parse`,
 *   `loadRun`, `follow`, or `onData` failures; IPC server maps those to error `stream-end`.
 */
export function createTailStreamHandler(deps: TailStreamHandlerDeps): StreamHandler {
  return async (_streamId, payload, onData, onClose, signal) => {
    const params = parseTailStreamParams(payload);
    if (!params || !deps.stateStore.loadRun(params.runId)) {
      onClose();
      return;
    }

    try {
      await streamRunLogRecords(deps, params.runId, params.afterSeq, params.follow, onData, signal);
    } finally {
      onClose();
    }
  };
}
