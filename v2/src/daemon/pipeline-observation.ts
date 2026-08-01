import { FOLLOW_POLL_MS } from "../persistence/log-stream.ts";
import type { Pipeline, PipelineStageRecord, StateStore } from "../persistence/state-store.ts";
import {
  branchSuffixPredecessorsSatisfied,
  derivePipelineState,
  findFanOutSplit,
  isAuthoredStageSatisfied,
  isPipelineTerminal,
  type PipelineDerivedState,
} from "./pipeline-execution.ts";

export const PIPELINE_WAIT_ABORTED = "pipeline_wait aborted";

export class PipelineWaitAbortedError extends Error {
  constructor() {
    super(PIPELINE_WAIT_ABORTED);
    this.name = "PipelineWaitAbortedError";
  }
}

export type PipelineTerminalState = Extract<PipelineDerivedState, "succeeded" | "failed" | "rejected" | "interrupted">;

export type PipelineBoundaryResult =
  | { kind: "terminal"; state: PipelineTerminalState }
  | { kind: "awaiting-approval"; stageId: string; branchKey: string };

export function derivePipelineBoundary(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
): PipelineBoundaryResult | null {
  const state = derivePipelineState(pipeline);
  if (isPipelineTerminal(state)) {
    return { kind: "terminal", state: state as PipelineTerminalState };
  }

  const split = findFanOutSplit(pipeline);
  for (const record of pipeline.stages) {
    const stage = pipeline.definition.stages[record.position];
    if (stage === undefined) continue;
    if (stage.kind !== "approval") continue;
    if (isAuthoredStageSatisfied(stage, record)) continue;
    if (record.status !== "awaiting" && record.status !== "pending") continue;
    if (!branchSuffixPredecessorsSatisfied(pipeline, record, split)) continue;
    return { kind: "awaiting-approval", stageId: stage.stageId, branchKey: record.branchKey };
  }
  return null;
}

type PipelineWaitWake = () => void;

export class PipelineWaitObserver {
  private readonly waiters = new Map<string, Set<PipelineWaitWake>>();

  notify(pipelineId: string): void {
    for (const wake of this.waiters.get(pipelineId) ?? []) {
      wake();
    }
  }

  subscribe(pipelineId: string, wake: PipelineWaitWake): () => void {
    let set = this.waiters.get(pipelineId);
    if (!set) {
      set = new Set();
      this.waiters.set(pipelineId, set);
    }
    set.add(wake);
    return () => {
      set.delete(wake);
      if (set.size === 0) {
        this.waiters.delete(pipelineId);
      }
    };
  }
}

export function bindPipelineWaitObserver(store: StateStore, observer: PipelineWaitObserver): StateStore {
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === "updateStage") {
        return (args: Parameters<StateStore["updateStage"]>[0]) => {
          target.updateStage(args);
          observer.notify(args.pipelineId);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function waitForNextPipelineObservation(
  pipelineId: string,
  signal: AbortSignal,
  observer: PipelineWaitObserver,
  pollMs: number,
): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      unsub();
      resolve();
    };
    const unsub = observer.subscribe(pipelineId, done);
    const onAbort = () => done();
    signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(done, pollMs);
    timer.unref?.();
  });
}

export async function waitForPipelineBoundary(
  store: StateStore,
  pipelineId: string,
  signal: AbortSignal,
  observer: PipelineWaitObserver,
  pollMs = FOLLOW_POLL_MS,
): Promise<PipelineBoundaryResult> {
  while (!signal.aborted) {
    const pipeline = store.loadPipeline(pipelineId);
    if (!pipeline) {
      throw new Error(`Pipeline ${pipelineId} not found`);
    }
    const boundary = derivePipelineBoundary(pipeline);
    if (boundary !== null) return boundary;
    await waitForNextPipelineObservation(pipelineId, signal, observer, pollMs);
  }

  throw new PipelineWaitAbortedError();
}

export type PipelineSnapshot = {
  pipelineId: string;
  name: string;
  state: PipelineDerivedState;
  createdAt: number;
  finishedAtMs: number | null;
  stages: Array<{
    stageId: string;
    branchKey: string;
    status: string;
    workflowInvocationId: string | null;
    startedAt: number | null;
    endedAt: number | null;
  }>;
};

function derivePipelineFinishedAtMs(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  state: PipelineDerivedState,
): number | null {
  if (!isPipelineTerminal(state)) {
    return null;
  }
  if (pipeline.terminalPublicationSucceededAt !== null) {
    return pipeline.terminalPublicationSucceededAt;
  }
  const endedAts = pipeline.stages
    .map((stage) => stage.endedAt)
    .filter((endedAt): endedAt is number => endedAt !== null);
  return endedAts.length > 0 ? Math.max(...endedAts) : pipeline.createdAt;
}

export function projectPipelineSnapshot(pipeline: Pipeline & { stages: PipelineStageRecord[] }): PipelineSnapshot {
  const state = derivePipelineState(pipeline);
  return {
    pipelineId: pipeline.id,
    name: pipeline.name,
    state,
    createdAt: pipeline.createdAt,
    finishedAtMs: derivePipelineFinishedAtMs(pipeline, state),
    stages: pipeline.stages.map((stage) => ({
      stageId: stage.stageId,
      branchKey: stage.branchKey,
      status: stage.status,
      workflowInvocationId: stage.workflowInvocationId,
      startedAt: stage.startedAt,
      endedAt: stage.endedAt,
    })),
  };
}
