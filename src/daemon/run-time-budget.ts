import { DEFAULT_RUN_TIMEOUT_MS, readRunTimeoutMs } from "../config/machine-config-loader.ts";
import type { LogSink } from "../persistence/log-stream.ts";
import { isTerminalRunStatus, type RunStatus, type StateStore } from "../persistence/state-store.ts";
import { signalRecordedVerifierProcessGroups } from "./daemon.ts";
import { KILL_SETTLEMENT_BOUND_MS } from "./run-kill-outcome.ts";

/** Bounded interval at which a live dispatch checkpoints its consumed whole-run budget. */
export const RUN_BUDGET_CHECKPOINT_INTERVAL_MS = 60_000;

type TimerHandle = { unref?: () => unknown };

/** Injectable clock and timers; production uses the globals. */
export type RunTimeoutTimers = {
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  setInterval: (callback: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
};

/** Daemon seams for the whole-run timeout: budget resolution per project and the monotonic clock. */
export type RunTimeoutDeps = {
  budgetMs?: (project: string) => number;
  timers?: RunTimeoutTimers;
  /** Bound between the abort and the forced `run_timeout` settlement of rows the dispatch left live. */
  settlementBoundMs?: number;
};

const unrefTimer = (handle: unknown): unknown => {
  (handle as TimerHandle | undefined)?.unref?.();
  return handle;
};

const realTimers: RunTimeoutTimers = {
  // Monotonic: host sleep and wall-clock steps must not consume run budget.
  now: () => performance.now(),
  setTimeout: (callback, ms) => unrefTimer(setTimeout(callback, ms)),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (callback, ms) => unrefTimer(setInterval(callback, ms)),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

/** Budget key shared by every dispatch of one run: the workflow invocation id, else the run id. */
export function runBudgetKey(run: { id: string; workflowSnapshot?: { invocationId: string } | null }): string {
  return run.workflowSnapshot?.invocationId ?? run.id;
}

/** Remaining whole-run budget; ≤ 0 means exhausted. */
export function remainingRunBudgetMs(budgetMs: number, consumedMs: number): number {
  return budgetMs - consumedMs;
}

/** Consumed budget after a dispatch armed at `armedAtMs` with `consumedAtArmMs` already spent. */
export function consumedRunBudgetMs(consumedAtArmMs: number, armedAtMs: number, nowMs: number): number {
  return consumedAtArmMs + Math.max(0, nowMs - armedAtMs);
}

/** Timer guard: the dispatch has spent its remaining budget. */
export function runTimeoutShouldFire(
  budgetMs: number,
  consumedAtArmMs: number,
  armedAtMs: number,
  nowMs: number,
): boolean {
  return remainingRunBudgetMs(budgetMs, consumedRunBudgetMs(consumedAtArmMs, armedAtMs, nowMs)) <= 0;
}

/** Resolves a project's budget from machine config; a config error logs and falls back to the default. */
export function resolveRunTimeoutBudgetMs(project: string, machineConfigPath: string | undefined): number {
  try {
    return readRunTimeoutMs(project, machineConfigPath);
  } catch (error) {
    console.error(`runTimeoutMs config rejected, using default ${DEFAULT_RUN_TIMEOUT_MS}ms:`, error);
    return DEFAULT_RUN_TIMEOUT_MS;
  }
}

/** Refusal for a resume whose whole-run budget is spent; undefined when budget remains. */
export function runTimeoutExhaustedRefusal(
  store: StateStore,
  budgetKey: string,
  budgetMs: number | undefined,
): { kind: "error"; code: "run_timeout_exhausted"; message: string } | undefined {
  if (budgetMs === undefined) return undefined;
  const consumedMs = store.readRunBudgetConsumedMs(budgetKey);
  if (remainingRunBudgetMs(budgetMs, consumedMs) > 0) return undefined;
  return {
    kind: "error",
    code: "run_timeout_exhausted",
    message: `Run budget exhausted (${consumedMs}ms consumed of runTimeoutMs ${budgetMs}ms); raise runTimeoutMs in machine config to resume`,
  };
}

/** Settles a row the timed-out dispatch left live `killed` with terminal cause `run_timeout` (resumable). */
export function settleRunTimeout(store: StateStore, runId: string): void {
  const run = store.loadRun(runId);
  if (!run || !runTimeoutSettles(run)) return;
  store.commitTerminalRunSettlement({ runId, status: "killed", terminalCause: "run_timeout" });
}

/**
 * Whether a row left by a timed-out dispatch takes `run_timeout` settlement: only rows still live
 * (including a deferred completion row held `in-progress` for publication). A row that already
 * settled — `completed` included, e.g. a linked `implement~link-N` whose PR evidence lives on the
 * completion row — is never touched.
 */
export function runTimeoutSettles(run: { status: RunStatus }): boolean {
  return !isTerminalRunStatus(run.status);
}

type ArmedRunTimeout = {
  /** Late-binds the budget key (a workflow learns its invocation id after dispatch starts). */
  bindKey: (budgetKey: string) => void;
  timedOut: () => boolean;
  /**
   * Call once the dispatch promise has unwound: clears every timer (including the force-settle
   * bound), persists consumed budget, and settles live `runIds()` `run_timeout` when the timer fired.
   * Idempotent.
   */
  settle: () => void;
};

/**
 * Arms one whole-run timer for a dispatch. Consumption accrues on the monotonic clock only while
 * armed, so paused time and host sleep are excluded; it checkpoints every
 * {@link RUN_BUDGET_CHECKPOINT_INTERVAL_MS} and on `settle`. An early wake reschedules the remainder,
 * and each checkpoint re-evaluates the guard, so a timer cannot silently never fire. On fire it calls
 * `onTimeout` (log, abort, signal) and force-settles rows still live after `settlementBoundMs` when
 * the dispatch never unwinds.
 */
export function armRunTimeout(args: {
  store: StateStore;
  budgetKey: string | undefined;
  /** Undefined (no production budget wired) arms nothing. */
  budgetMs: number | undefined;
  runIds: () => Iterable<string>;
  timers?: RunTimeoutTimers;
  settlementBoundMs?: number;
  onTimeout: (consumedMs: number) => void;
}): ArmedRunTimeout {
  const budgetMs = args.budgetMs;
  if (budgetMs === undefined) return { bindKey: () => {}, timedOut: () => false, settle: () => {} };
  const timers = args.timers ?? realTimers;
  let key = args.budgetKey;
  const consumedAtArm = key === undefined ? 0 : args.store.readRunBudgetConsumedMs(key);
  const armedAt = timers.now();
  let fired = false;
  let settled = false;
  let timeout: unknown;
  let forceSettle: unknown;
  const settleLiveRows = (): void => {
    for (const runId of args.runIds()) settleRunTimeout(args.store, runId);
  };
  const persist = (): number => {
    const consumed = consumedRunBudgetMs(consumedAtArm, armedAt, timers.now());
    if (key !== undefined) {
      try {
        args.store.writeRunBudgetConsumedMs(key, consumed);
      } catch (error) {
        console.error(`Run budget checkpoint for ${key} failed:`, error);
      }
    }
    return consumed;
  };
  const onTimer = (): void => {
    if (settled || fired) return;
    const nowMs = timers.now();
    if (!runTimeoutShouldFire(budgetMs, consumedAtArm, armedAt, nowMs)) {
      timers.clearTimeout(timeout);
      timeout = timers.setTimeout(
        onTimer,
        remainingRunBudgetMs(budgetMs, consumedRunBudgetMs(consumedAtArm, armedAt, nowMs)),
      );
      return;
    }
    fired = true;
    timers.clearTimeout(timeout);
    args.onTimeout(persist());
    forceSettle = timers.setTimeout(() => {
      if (!settled) settleLiveRows();
    }, args.settlementBoundMs ?? KILL_SETTLEMENT_BOUND_MS);
  };
  timeout = timers.setTimeout(onTimer, Math.max(0, remainingRunBudgetMs(budgetMs, consumedAtArm)));
  const interval = timers.setInterval(() => {
    if (settled) return;
    persist();
    onTimer();
  }, RUN_BUDGET_CHECKPOINT_INTERVAL_MS);
  return {
    bindKey: (budgetKey) => {
      key ??= budgetKey;
    },
    timedOut: () => fired,
    settle: () => {
      if (settled) return;
      settled = true;
      timers.clearTimeout(timeout);
      timers.clearTimeout(forceSettle);
      timers.clearInterval(interval);
      persist();
      if (fired) settleLiveRows();
    },
  };
}

/** Same abort path as `run kill`: log `run_timeout`, abort the dispatch, signal recorded verifier process groups. */
export function fireRunTimeout(args: {
  store: StateStore;
  abortController: AbortController;
  runIds: Iterable<string>;
  logSink: Pick<LogSink, "append"> | undefined;
  budgetMs: number;
  consumedMs: number;
}): void {
  const runIds = new Set(args.runIds);
  for (const runId of runIds) {
    try {
      args.logSink?.append(runId, { kind: "run_timeout", budgetMs: args.budgetMs, consumedMs: args.consumedMs });
    } catch {
      // log append failure does not block the abort
    }
  }
  args.abortController.abort();
  signalRecordedVerifierProcessGroups(args.store, runIds);
}
