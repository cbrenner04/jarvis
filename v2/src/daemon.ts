import { homedir } from "node:os";
import { join } from "node:path";
import { createAgentBindings } from "../../shared/invocation/agents.ts";
import { getExternalWorktreePath } from "./external-worktree.ts";
import { type IpcServer, type RpcHandler, type StreamHandler, startIpcServer } from "./ipc/server";
import { type LogReader, type LoopFinishedEvent, openLogReader, openLogSink } from "./persistence/log-stream.ts";
import { openStateStore, type StateStore } from "./persistence/state-store.ts";
import type { RunStatus } from "./persistence/state-store-types.ts";
import {
  composeRunOperatorError,
  findTerminalLogRecord,
  type RunOperatorError,
  type TerminalLogRecord,
} from "./run-operator-error.ts";
import { executeWriteLoop, type WriteLoopInput } from "./write-loop.ts";

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
  pauseController: AbortController;
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

function ownershipKeyString(key: OwnershipKey): string {
  return `${key.project}:${key.branch}`;
}

export class WorktreeOwnershipRegistry {
  private registry = new Map<string, WorktreeOwnership>();

  claim(key: OwnershipKey, ownership: WorktreeOwnership): void {
    const ks = ownershipKeyString(key);
    if (this.registry.has(ks)) {
      throw new DaemonDoubleClaimError(key);
    }
    this.registry.set(ks, ownership);
  }

  release(key: OwnershipKey): void {
    this.registry.delete(ownershipKeyString(key));
  }

  get(key: OwnershipKey): WorktreeOwnership | undefined {
    return this.registry.get(ownershipKeyString(key));
  }

  isClaimed(key: OwnershipKey): boolean {
    return this.registry.has(ownershipKeyString(key));
  }
}

function isTerminalRunStatus(status: RunStatus): boolean {
  return (
    status === "completed" || status === "blocked" || status === "killed" || status === "paused" || status === "failed"
  );
}

/**
 * Production failure reporter: opens the log sink and appends one
 * `run_execution_failed` event. Used by {@link startDaemon}; exported for tests.
 */
export function createRunExecutionFailureReporter(logsPath: string): (runId: string, reason: unknown) => Promise<void> {
  return async (runId, _reason) => {
    const logSink = openLogSink(logsPath);
    try {
      logSink.append(runId, { kind: "run_execution_failed" });
    } finally {
      logSink.close();
    }
  };
}

function normalizeBindings(input: WriteLoopInput): WriteLoopInput {
  const bindingIds = input.bindings
    .map((binding) => {
      if (typeof binding !== "object" || binding === null) return null;
      const id = "id" in binding ? binding.id : undefined;
      return typeof id === "string" ? id : null;
    })
    .filter((id): id is string => id !== null);

  const hasLiveBindings = input.bindings.every(
    (binding) =>
      typeof binding === "object" && binding !== null && "invoke" in binding && typeof binding.invoke === "function",
  );

  if (hasLiveBindings || bindingIds.length === 0) {
    return input;
  }

  return {
    ...input,
    bindings: createAgentBindings(bindingIds),
  };
}

/**
 * Injectable dependencies for {@link createRunControlHandlers}.
 *
 * - `stateStore`: durable run rows — `createRun` on start, `listRuns`/`loadRun` on
 *   list/pause/resume/kill, `setRunStatus` on kill and spawn-boundary failure capture.
 * - `writeLoopExecutor`: write-loop body only; factory owns claim/release and
 *   fire-and-forget spawn. Log-sink open/close stays in {@link startDaemon}'s
 *   production wrapper. Executor rejections do not propagate to RPC callers.
 * - `failureReporter`: invoked on spawn-boundary executor rejection with the original
 *   rejection value; awaited before ownership release. Sync or async.
 */
export type RunControlHandlerDeps = {
  stateStore: StateStore;
  logReader?: LogReader;
  writeLoopExecutor: (input: WriteLoopInput, signal: AbortSignal, pauseSignal: AbortSignal) => Promise<void>;
  failureReporter: (runId: string, reason: unknown) => void | Promise<void>;
};

export type WaitRunCompletionResult = {
  runStatus: RunStatus;
  loopOutcomeKind?: LoopFinishedEvent["loopOutcomeKind"];
  iterationsConsumed?: number;
  resumable?: boolean;
  error?: RunOperatorError;
};

type Waiter = {
  minSeq: number;
  resolve: (value: WaitRunCompletionResult) => void;
  reject: (reason: unknown) => void;
  signal: AbortSignal;
  abortListener: () => void;
};

type WaitFanout = {
  controller: AbortController;
  waiters: Set<Waiter>;
};

/**
 * Run-control handler factory for `start`/`list`/`pause`/`resume`/`kill`.
 *
 * @param deps - {@link RunControlHandlerDeps}
 * @returns `{ start, list, pause, resume, kill }` — each an {@link RpcHandler}.
 *   Handlers signal rejections via `{ kind: "error", code, message }`; they do not throw.
 * @throws Never — factory and handlers are non-throwing at the RPC boundary.
 * @invariant Each invocation gets a fresh `WorktreeOwnershipRegistry` and `activeRuns` map.
 * @invariant Write loops spawn fire-and-forget; settlement always releases registry and
 *   active-run entries. Spawn-boundary executor rejections best-effort persist `failed`,
 *   await `failureReporter`, then release — they do not propagate to RPC callers.
 */
export function createRunControlHandlers(deps: RunControlHandlerDeps) {
  const _registry = new WorktreeOwnershipRegistry();
  const activeRuns = new Map<string, ActiveRun>();
  const waitFanouts = new Map<string, WaitFanout>();
  const { stateStore: store, logReader, writeLoopExecutor, failureReporter } = deps;

  const resultFrom = (runId: string, runStatus: RunStatus, record?: TerminalLogRecord): WaitRunCompletionResult => {
    const run = store.loadRun(runId);
    const error = run ? composeRunOperatorError(run, record) : undefined;
    const base: WaitRunCompletionResult =
      record?.event.kind === "loop_finished"
        ? {
            runStatus,
            loopOutcomeKind: record.event.loopOutcomeKind,
            iterationsConsumed: record.event.iterationsConsumed,
            resumable: record.event.resumable,
          }
        : { runStatus };
    return error === undefined ? base : { ...base, error };
  };

  const detachWaiter = (runId: string, waiter: Waiter): void => {
    waiter.signal.removeEventListener("abort", waiter.abortListener);
    const fanout = waitFanouts.get(runId);
    if (!fanout) return;
    fanout.waiters.delete(waiter);
    if (fanout.waiters.size === 0) {
      fanout.controller.abort();
      waitFanouts.delete(runId);
    }
  };

  const resolveWaiters = (runId: string, record: TerminalLogRecord): void => {
    const fanout = waitFanouts.get(runId);
    if (!fanout) return;
    const run = store.loadRun(runId);
    const runStatus = run?.status ?? "failed";
    for (const waiter of Array.from(fanout.waiters)) {
      if (record.seq <= waiter.minSeq) continue;
      detachWaiter(runId, waiter);
      waiter.resolve(resultFrom(runId, runStatus, record));
    }
  };

  const ensureWaitFanout = (runId: string): WaitFanout => {
    const existing = waitFanouts.get(runId);
    if (existing) return existing;

    const fanout: WaitFanout = { controller: new AbortController(), waiters: new Set() };
    waitFanouts.set(runId, fanout);
    (async () => {
      try {
        if (!logReader) return;
        for await (const record of logReader.follow(runId, fanout.controller.signal)) {
          if (record.event.kind === "loop_finished" || record.event.kind === "run_execution_failed") {
            resolveWaiters(runId, record as TerminalLogRecord);
          }
          if (fanout.waiters.size === 0) break;
        }
      } catch (err) {
        for (const waiter of Array.from(fanout.waiters)) {
          detachWaiter(runId, waiter);
          waiter.reject(err);
        }
      } finally {
        fanout.controller.abort();
        waitFanouts.delete(runId);
      }
    })();
    return fanout;
  };

  const spawnWriteLoop = (key: OwnershipKey, runId: string, worktreePath: string, input: WriteLoopInput): void => {
    const ks = ownershipKeyString(key);
    const abortController = new AbortController();
    const pauseController = new AbortController();
    activeRuns.set(ks, { runId, key, abortController, pauseController });

    _registry.claim(key, { runId, worktreePath });

    (async () => {
      try {
        await writeLoopExecutor(input, abortController.signal, pauseController.signal);
      } catch (reason) {
        try {
          const run = store.loadRun(runId);
          if (run && !isTerminalRunStatus(run.status)) {
            store.setRunStatus(runId, "failed");
          }
        } catch {
          // best-effort persist; cleanup still runs
        }
        try {
          await failureReporter(runId, reason);
        } catch {
          // reporter failure does not block cleanup or roll back status
        }
      } finally {
        activeRuns.delete(ks);
        _registry.release(key);
      }
    })();
  };

  const startHandler: RpcHandler = (frame) => {
    const params = frame.params as { input?: WriteLoopInput } | undefined;
    if (!params?.input) {
      return { kind: "error", code: "invalid_params", message: "Missing input" };
    }

    const input = normalizeBindings(params.input as WriteLoopInput);
    const key: OwnershipKey = {
      project: input.worktree.projectName,
      branch: input.worktree.branchName,
    };

    // Check per-(project, branch) guard first (more specific than the global guard).
    if (_registry.isClaimed(key)) {
      return {
        kind: "error",
        code: "worktree_claimed",
        message: `Worktree already claimed for project=${key.project}, branch=${key.branch}`,
      };
    }

    // Check single in-flight run guard (global; a different (project, branch) still rejects).
    if (activeRuns.size > 0) {
      return {
        kind: "error",
        code: "run_in_progress",
        message: "A run is already in progress; at most one in-flight run globally",
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

    spawnWriteLoop(key, runId, worktreePath, input);

    return { kind: "response", result: { runId } };
  };

  const listHandler: RpcHandler = () => {
    const durableRuns = store.listRuns();

    const runList = durableRuns.map((run) => {
      const ks = ownershipKeyString({ project: run.project, branch: run.branch });
      const isLive = activeRuns.has(ks);
      const fullRun = store.loadRun(run.id);
      const records = logReader?.tail(run.id) ?? [];
      const error = fullRun ? composeRunOperatorError(fullRun, findTerminalLogRecord(records)) : undefined;
      return {
        runId: run.id,
        project: run.project,
        branch: run.branch,
        status: run.status,
        isLive,
        ...(error !== undefined ? { error } : {}),
      };
    });

    return { kind: "response", result: { runs: runList } };
  };

  const pauseHandler: RpcHandler = (frame) => {
    const params = frame.params as { runId?: string } | undefined;
    if (!params?.runId) {
      return { kind: "error", code: "invalid_params", message: "Missing runId" };
    }

    const runId = params.runId as string;
    const run = store.loadRun(runId);
    if (!run) {
      return { kind: "error", code: "unknown_run", message: `Run ${runId} not found` };
    }

    const ks = ownershipKeyString({ project: run.project, branch: run.branch });
    const activeRun = activeRuns.get(ks);
    if (activeRun && activeRun.runId === runId) {
      activeRun.pauseController.abort();
      return { kind: "response", result: { ok: true } };
    }

    return { kind: "error", code: "run_not_active", message: `Run ${runId} is not currently active` };
  };

  const killHandler: RpcHandler = (frame) => {
    const params = frame.params as { runId?: string } | undefined;
    if (!params?.runId) {
      return { kind: "error", code: "invalid_params", message: "Missing runId" };
    }

    const runId = params.runId as string;
    const run = store.loadRun(runId);
    if (!run) {
      return { kind: "error", code: "unknown_run", message: `Run ${runId} not found` };
    }

    const ks = ownershipKeyString({ project: run.project, branch: run.branch });
    const activeRun = activeRuns.get(ks);
    if (activeRun && activeRun.runId === runId) {
      activeRun.abortController.abort();
      store.setRunStatus(runId, "killed");
      return { kind: "response", result: { ok: true } };
    }

    return { kind: "error", code: "run_not_active", message: `Run ${runId} is not currently active` };
  };

  const resumeHandler: RpcHandler = (frame) => {
    const params = frame.params as { runId?: string } | undefined;
    if (!params?.runId) {
      return { kind: "error", code: "invalid_params", message: "Missing runId" };
    }

    const runId = params.runId as string;
    const run = store.loadRun(runId);
    if (!run) {
      return { kind: "error", code: "unknown_run", message: `Run ${runId} not found` };
    }

    // Reject terminal statuses
    if (run.status === "completed" || run.status === "failed" || run.status === "blocked") {
      return { kind: "error", code: "terminal_run", message: `Cannot resume a ${run.status} run` };
    }

    const key: OwnershipKey = { project: run.project, branch: run.branch };

    // Check per-(project, branch) guard first (more specific than the global guard).
    if (_registry.isClaimed(key)) {
      return {
        kind: "error",
        code: "worktree_claimed",
        message: `Worktree already claimed for project=${key.project}, branch=${key.branch}`,
      };
    }

    // Check single in-flight run guard (global; a different (project, branch) still rejects).
    if (activeRuns.size > 0) {
      return {
        kind: "error",
        code: "run_in_progress",
        message: "A run is already in progress; at most one in-flight run globally",
      };
    }

    // Reconstruct WriteLoopInput from the run and spawn write loop via injected executor
    const input: WriteLoopInput = {
      worktree: {
        projectRoot: run.worktreePath,
        projectName: run.project,
        branchName: run.branch,
        baseRef: run.specRef,
      },
      specPath: run.specPath,
      stepRules: "", // These should be reconstructed from the calling context
      expectedArtifactPath: "", // These should be reconstructed from the calling context
      bindings: [],
    };

    spawnWriteLoop(key, runId, run.worktreePath, input);

    return { kind: "response", result: { ok: true } };
  };

  const waitHandler: RpcHandler = async (frame, signal) => {
    if (!logReader) {
      return { kind: "error", code: "internal_error", message: "wait requires logReader" };
    }
    const params = frame.params as { runId?: string } | undefined;
    if (!params?.runId || typeof params.runId !== "string") {
      return { kind: "error", code: "invalid_params", message: "Missing runId" };
    }

    const runId = params.runId;
    const run = store.loadRun(runId);
    if (!run) {
      return { kind: "error", code: "unknown_run", message: `Run ${runId} not found` };
    }

    const records = logReader.tail(runId);
    const subscribeSeq = records.at(-1)?.seq ?? 0;
    if (run.status !== "in-progress") {
      return { kind: "response", result: resultFrom(runId, run.status, findTerminalLogRecord(records)) };
    }

    return {
      kind: "response",
      result: await new Promise<WaitRunCompletionResult>((resolve, reject) => {
        const waiter: Waiter = {
          minSeq: subscribeSeq,
          resolve,
          reject,
          signal,
          abortListener: () => {
            detachWaiter(runId, waiter);
            reject(new Error("wait aborted"));
          },
        };
        if (signal.aborted) {
          reject(new Error("wait aborted"));
          return;
        }
        signal.addEventListener("abort", waiter.abortListener, { once: true });
        ensureWaitFanout(runId).waiters.add(waiter);
      }),
    };
  };

  return {
    start: startHandler,
    list: listHandler,
    pause: pauseHandler,
    resume: resumeHandler,
    kill: killHandler,
    wait: waitHandler,
  };
}

/**
 * Injectable dependencies for {@link createTailStreamHandler}.
 *
 * - `stateStore`: durable run rows — `loadRun` gates unknown runs; falsy closes without calling
 *   `follow`. Guard paths are non-throwing; `loadRun` rejections propagate to IPC.
 * - `logReader`: persisted log events — `follow` replays and streams appends only after a truthy
 *   `loadRun`. `follow` and `onData` failures propagate to IPC as error `stream-end`.
 *
 * @throws N/A — deps bag only; the factory does not throw at construction.
 * @invariant Handler never invokes `logReader.follow` without a prior truthy `loadRun`.
 * @invariant Malformed payload and unknown-run guard paths close synchronously without `follow`.
 */
export type TailStreamHandlerDeps = {
  stateStore: StateStore;
  logReader: LogReader;
};

/**
 * Tail-log stream handler factory for IPC `stream-open` on run logs.
 *
 * @param deps - {@link TailStreamHandlerDeps}
 * @returns A {@link StreamHandler} — replays persisted events and streams live appends for known runs.
 * @throws N/A at factory call — returned handler may throw/reject on string-payload `JSON.parse`,
 *   `loadRun`, `follow`, or `onData` failures; IPC server maps those to error `stream-end`.
 * @invariant Validates `loadRun` before calling `follow`; unknown or malformed `runId` closes without data.
 * @invariant Guard paths (malformed/missing `runId`, unknown run) invoke `onClose` once synchronously
 *   and never call `follow`.
 * @invariant Follow path invokes `onClose` in `finally` after `follow` completes or aborts.
 */
export function createTailStreamHandler(deps: TailStreamHandlerDeps): StreamHandler {
  return async (_streamId, payload, onData, onClose, signal) => {
    const params = typeof payload === "string" && payload ? JSON.parse(payload) : payload;
    if (!params?.runId || typeof params.runId !== "string") {
      onClose();
      return;
    }

    const runId = params.runId;
    if (!deps.stateStore.loadRun(runId)) {
      onClose();
      return;
    }

    try {
      for await (const record of deps.logReader.follow(runId, signal)) {
        if (signal.aborted) break;
        onData(record);
      }
    } finally {
      onClose();
    }
  };
}

export async function startDaemon(socketPath: string, stateStore?: StateStore, logReader?: LogReader): Promise<void> {
  const store = stateStore ?? openStateStore();
  const logsPath = join(homedir(), ".jarvis", "state", "logs.jsonl");
  const logReaderInstance = logReader ?? openLogReader(logsPath);
  let shutdownRequested = false;

  const writeLoopExecutor = async (input: WriteLoopInput, signal: AbortSignal, pauseSignal: AbortSignal) => {
    const logSink = openLogSink(logsPath);
    try {
      await executeWriteLoop({
        ...input,
        stateStore: store,
        logSink,
        signal,
        pauseSignal,
      });
    } finally {
      logSink.close();
    }
  };

  const tailStreamHandler = createTailStreamHandler({ stateStore: store, logReader: logReaderInstance });

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
    ...createRunControlHandlers({
      stateStore: store,
      logReader: logReaderInstance,
      writeLoopExecutor,
      failureReporter: createRunExecutionFailureReporter(logsPath),
    }),
  };

  let server: IpcServer;

  try {
    server = await startIpcServer(socketPath, handlers, tailStreamHandler);
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
          if (!logReader) {
            const closeable = logReaderInstance as { close?: () => void };
            closeable.close?.();
          }
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
