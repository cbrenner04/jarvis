import { isRecord } from "../../../shared/is-record.ts";
import { FOLLOW_POLL_MS } from "../persistence/log-stream.ts";
import {
  DEFAULT_PIPELINE_STAGE_BRANCH_KEY,
  type Pipeline,
  type PipelineStageRecord,
  type StateStore,
} from "../persistence/state-store.ts";
import {
  branchSuffixPredecessorsSatisfied,
  derivePipelineState,
  fanOutBranchSuffixTerminallySettled,
  findFanOutSplit,
  isAuthoredStageSatisfied,
  isPipelineTerminal,
  narrowPipelineStageArtifact,
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

type AwaitingApprovalGate = { stageId: string; branchKey: string; record: PipelineStageRecord };

/** Every reachable undecided approval gate on a non-terminal pipeline, in stage-row order. */
export function derivePipelineAwaitingGates(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
): AwaitingApprovalGate[] {
  if (isPipelineTerminal(derivePipelineState(pipeline))) return [];
  const split = findFanOutSplit(pipeline);
  const gates: AwaitingApprovalGate[] = [];
  for (const record of pipeline.stages) {
    const stage = pipeline.definition.stages[record.position];
    if (stage === undefined) continue;
    if (stage.kind !== "approval") continue;
    if (isAuthoredStageSatisfied(stage, record)) continue;
    if (record.status !== "awaiting" && record.status !== "pending") continue;
    if (split !== null && fanOutBranchSuffixTerminallySettled(pipeline, split, record.branchKey)) continue;
    if (!branchSuffixPredecessorsSatisfied(pipeline, record, split)) continue;
    gates.push({ stageId: stage.stageId, branchKey: record.branchKey, record });
  }
  return gates;
}

export function derivePipelineBoundary(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
): PipelineBoundaryResult | null {
  const state = derivePipelineState(pipeline);
  if (isPipelineTerminal(state)) {
    return { kind: "terminal", state: state as PipelineTerminalState };
  }
  const gate = derivePipelineAwaitingGates(pipeline)[0];
  if (gate === undefined) return null;
  return { kind: "awaiting-approval", stageId: gate.stageId, branchKey: gate.branchKey };
}

type PipelineOwnershipResult =
  | { kind: "owner" }
  | { kind: "not_owner" }
  | { kind: "durable_state"; state: PipelineDerivedState }
  | { kind: "not_found" };

/**
 * Ownership answer for `pipeline_owner`: derived-terminal state (or a reconciled `interrupted`
 * durable status) is checked first, independent of `ownerIdentity` — a finished pipeline whose
 * owner happens to still be up is not routed as if further control RPCs made sense against it.
 * Otherwise an `active` row is `owner` only under this process's own identity; any other
 * identity, including `null` (unowned), is `not_owner`.
 */
export function resolvePipelineOwnership(
  pipeline: (Pipeline & { stages: PipelineStageRecord[] }) | null,
  currentIdentity: string,
): PipelineOwnershipResult {
  if (pipeline === null) return { kind: "not_found" };
  const state = derivePipelineState(pipeline);
  if (isPipelineTerminal(state) || pipeline.status === "interrupted") {
    return { kind: "durable_state", state };
  }
  return pipeline.ownerIdentity === currentIdentity ? { kind: "owner" } : { kind: "not_owner" };
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
  terminalAction?: Pipeline["definition"]["terminalAction"] | undefined;
  seedPath?: string | undefined;
  terminalPublicationSucceededAt: number | null;
  terminalPublicationFailure: Pipeline["terminalPublicationFailure"];
  createdAt: number;
  finishedAtMs: number | null;
  dismissedAt: number | null;
  stages: Array<{
    id: string;
    stageId: string;
    branchKey: string;
    position: number;
    status: string;
    workflowInvocationId: string | null;
    startedAt: number | null;
    endedAt: number | null;
    decidedAt: number | null;
    artifact: unknown;
    failureDetail: unknown;
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
  const candidateFinishAts = pipeline.stages.flatMap((stage) => [stage.endedAt, stage.decidedAt]);
  const finishAts = candidateFinishAts.filter((finishedAt): finishedAt is number => finishedAt !== null);
  return finishAts.length > 0 ? Math.max(...finishAts) : pipeline.createdAt;
}

const STALE_PUBLICATION_STAGE_FAILURE_CODES = new Set(["completion_publication_missing_pr_evidence"]);
const STALE_PUBLICATION_STAGE_FAILURE_REASONS = new Set([
  "completion_commit_failed",
  "iteration_commit_failed",
  "ready_flip_failed",
]);

function isStalePublicationFailedStageFailureDetail(failureDetail: unknown): boolean {
  if (failureDetail === null || typeof failureDetail !== "object") return false;
  const record = failureDetail as { code?: string; reason?: string };
  if (record.code !== undefined && STALE_PUBLICATION_STAGE_FAILURE_CODES.has(record.code)) return true;
  return record.reason !== undefined && STALE_PUBLICATION_STAGE_FAILURE_REASONS.has(record.reason);
}

function readStageTerminalPublicationStamp(artifact: unknown): unknown {
  if (!isRecord(artifact)) return undefined;
  return artifact.terminalPublication;
}

function isFanOutSuffixTerminalWorkflowStage(
  stage: PipelineStageRecord,
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
): boolean {
  if (stage.branchKey === DEFAULT_PIPELINE_STAGE_BRANCH_KEY) return false;
  if (stage.status !== "succeeded") return false;
  const split = findFanOutSplit(pipeline);
  if (split === null) return false;
  const authored = pipeline.definition.stages[stage.position];
  if (authored?.kind !== "workflow") return false;
  for (let position = pipeline.definition.stages.length - 1; position > split.splitPosition; position -= 1) {
    const def = pipeline.definition.stages[position];
    if (def?.kind !== "workflow") continue;
    return position === stage.position;
  }
  return false;
}

function projectObservedStageArtifact(
  stage: PipelineStageRecord,
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
): unknown {
  const raw = stage.artifact;
  if (!isFanOutSuffixTerminalWorkflowStage(stage, pipeline)) {
    return raw;
  }
  const stamp = readStageTerminalPublicationStamp(raw);
  if (stamp === undefined) {
    return raw;
  }
  const narrowed = narrowPipelineStageArtifact(raw);
  const base = narrowed ?? (isRecord(raw) ? raw : {});
  return { ...base, terminalPublication: stamp };
}

function projectObservedPipelineStage(
  stage: PipelineStageRecord,
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
): PipelineSnapshot["stages"][number] {
  const artifact = narrowPipelineStageArtifact(stage.artifact);
  const laneOutcome = artifact?.lanePrOutcome;
  let status = stage.status;
  let failureDetail = stage.failureDetail;
  if (laneOutcome !== undefined) {
    if (laneOutcome.kind === "lane_pr_merged") {
      status = "succeeded";
    }
    if (isStalePublicationFailedStageFailureDetail(failureDetail)) {
      failureDetail = null;
    }
  }
  return {
    id: stage.id,
    stageId: stage.stageId,
    branchKey: stage.branchKey,
    position: stage.position,
    status,
    workflowInvocationId: stage.workflowInvocationId,
    startedAt: stage.startedAt,
    endedAt: stage.endedAt,
    decidedAt: stage.decidedAt,
    artifact: projectObservedStageArtifact(stage, pipeline),
    failureDetail,
  };
}

export function projectPipelineSnapshot(pipeline: Pipeline & { stages: PipelineStageRecord[] }): PipelineSnapshot {
  const state = derivePipelineState(pipeline);
  return {
    pipelineId: pipeline.id,
    name: pipeline.name,
    state,
    terminalAction: pipeline.definition.terminalAction,
    seedPath: pipeline.context?.seedPath,
    terminalPublicationSucceededAt: pipeline.terminalPublicationSucceededAt,
    terminalPublicationFailure: pipeline.terminalPublicationFailure,
    createdAt: pipeline.createdAt,
    finishedAtMs: derivePipelineFinishedAtMs(pipeline, state),
    dismissedAt: pipeline.dismissedAt,
    stages: pipeline.stages.map((stage) => projectObservedPipelineStage(stage, pipeline)),
  };
}
