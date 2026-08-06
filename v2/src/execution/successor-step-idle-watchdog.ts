import { DEFAULT_IDLE_OUTPUT_TIMEOUT_MS } from "../config/machine-config-loader.ts";
import type { LogSink } from "../persistence/log-stream.ts";
import type { StateStore } from "../persistence/state-store.ts";
import type { InvocationFailureDetail } from "./invocation-failure.ts";

export type SuccessorShellStallOutcome = {
  kind: "invocation_failure";
  runId: string;
  iterationsConsumed: 0;
  resumable: true;
  successorShellStall: true;
};

export function isSuccessorShellStallOutcome(outcome: unknown): outcome is SuccessorShellStallOutcome {
  return (
    typeof outcome === "object" &&
    outcome !== null &&
    (outcome as SuccessorShellStallOutcome).successorShellStall === true
  );
}

type SuccessorShellIdleWatchdog = {
  disarm: () => void;
  stalled: Promise<boolean>;
};

/** Review-role semantics: absent key → 90 s; explicit `0` disables shell arming. */
export function resolveSuccessorShellIdleBoundMs(idleOutputMs?: number): number | undefined {
  if (idleOutputMs === 0) return undefined;
  if (idleOutputMs === undefined) return DEFAULT_IDLE_OUTPUT_TIMEOUT_MS;
  return idleOutputMs;
}

function buildSuccessorShellStallDetail(boundMs: number): InvocationFailureDetail {
  return {
    failureKind: "stall",
    boundMs,
    bindingAttempts: [],
    message: `successor shell exceeded ${boundMs}ms idle bound before first role invocation`,
  };
}

export function armSuccessorShellIdleWatchdog(args: {
  idleOutputMs?: number;
  signal?: AbortSignal;
  onStall: () => void;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}): SuccessorShellIdleWatchdog | undefined {
  const boundMs = resolveSuccessorShellIdleBoundMs(args.idleOutputMs);
  if (boundMs === undefined) return undefined;

  let disarmed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveStalled!: (value: boolean) => void;
  const stalled = new Promise<boolean>((resolve) => {
    resolveStalled = resolve;
  });
  const setTimeoutFn = args.setTimeout ?? setTimeout;
  const clearTimeoutFn = args.clearTimeout ?? clearTimeout;

  const disarm = () => {
    if (disarmed) return;
    disarmed = true;
    if (timer !== undefined) clearTimeoutFn(timer);
    resolveStalled(false);
  };

  timer = setTimeoutFn(() => {
    if (disarmed) return;
    disarmed = true;
    args.onStall();
    resolveStalled(true);
  }, boundMs);

  args.signal?.addEventListener("abort", disarm, { once: true });

  return { disarm, stalled };
}

function settleSuccessorShellStall(args: {
  store: StateStore;
  logSink?: LogSink;
  runId: string;
  attemptId: string;
  boundMs: number;
}): SuccessorShellStallOutcome {
  const detail = buildSuccessorShellStallDetail(args.boundMs);
  args.store.commitCompletionBoundary({
    attemptId: args.attemptId,
    runStatus: "failed",
    outcomeKind: "invocation_failure",
    invocationFailureDetail: detail,
  });
  const outcome: SuccessorShellStallOutcome = {
    kind: "invocation_failure",
    runId: args.runId,
    iterationsConsumed: 0,
    resumable: true,
    successorShellStall: true,
  };
  args.logSink?.append(args.runId, {
    kind: "loop_finished",
    loopOutcomeKind: outcome.kind,
    iterationsConsumed: outcome.iterationsConsumed,
    resumable: outcome.resumable,
  });
  return outcome;
}

type SuccessorShellIdleContext = {
  idleOutputMs?: number;
  signal?: AbortSignal;
  runId: string;
  attemptId: string;
  store: StateStore;
  logSink?: LogSink;
};

export async function raceSuccessorShellIdle<T>(
  ctx: SuccessorShellIdleContext,
  shellIdleWatchdog: SuccessorShellIdleWatchdog | undefined,
  stallAbort: AbortController,
  run: (handoff: { signal: AbortSignal | undefined; onRoleStart: () => void }) => Promise<T>,
): Promise<T | SuccessorShellStallOutcome> {
  const boundMs = resolveSuccessorShellIdleBoundMs(ctx.idleOutputMs);
  const signal =
    ctx.signal !== undefined ? AbortSignal.any([ctx.signal, stallAbort.signal]) : stallAbort.signal;

  if (shellIdleWatchdog === undefined || boundMs === undefined) {
    return run({ signal: ctx.signal, onRoleStart: () => {} });
  }

  const stepPromise = run({
    signal,
    onRoleStart: () => shellIdleWatchdog.disarm(),
  });

  const stalled = await Promise.race([shellIdleWatchdog.stalled, stepPromise.then(() => false as const)]);
  shellIdleWatchdog.disarm();

  if (stalled) {
    stallAbort.abort();
    return settleSuccessorShellStall({
      store: ctx.store,
      runId: ctx.runId,
      attemptId: ctx.attemptId,
      boundMs,
      ...(ctx.logSink !== undefined ? { logSink: ctx.logSink } : {}),
    });
  }

  return stepPromise;
}
