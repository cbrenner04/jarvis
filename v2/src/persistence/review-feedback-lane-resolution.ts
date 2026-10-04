import { REVIEW_FEEDBACK_WRITE_PROMPT_ID } from "../shared/prompts/review-feedback-write.ts";
import type { WorkflowPipelineStage } from "../execution/pipeline-definition.ts";
import { resolveInvocationEntryRunId } from "./invocation-entry-run.ts";
import { resolvePrEvidenceAcrossInvocation } from "./pipeline-stage-settlement.ts";
import {
  isTerminalRunStatus,
  type Pipeline,
  type PipelineStageRecord,
  type Run,
  type StateStore,
  type WorkflowSnapshotStep,
} from "./state-store.ts";
import { resolveWorkflowRunRollup } from "./workflow-run-status-rollup.ts";

export type ReviewFeedbackLaneKind = "intent" | "plan" | "implement";

type ReviewFeedbackLaneProvenance =
  | { kind: "bare" }
  | { kind: "pipeline"; pipelineId: string; stageId: string; branchKey: string };

export type ReviewFeedbackLaneTarget = {
  laneKind: ReviewFeedbackLaneKind;
  project: string;
  branch: string;
  worktreePath: string;
  prNumber: number;
  prUrl: string;
  entryRunId: string;
  entrySpecPath: string;
  baseRef: string;
  provenance: ReviewFeedbackLaneProvenance;
};

export type ReviewFeedbackLaneRefusalCode =
  | "review_feedback_lane_in_flight"
  | "review_feedback_lane_unmatched"
  | "review_feedback_lane_ambiguous"
  | "review_feedback_lane_not_eligible";

type ReviewFeedbackLaneResolutionResult =
  | { ok: true; target: ReviewFeedbackLaneTarget }
  | { ok: false; code: ReviewFeedbackLaneRefusalCode; message: string };

export type ReviewFeedbackLaneBareRequest = {
  mode: "bare";
  project: string;
  branch: string;
};

export type ReviewFeedbackLanePipelineRequest = {
  mode: "pipeline";
  project: string;
  branch: string;
  pipelineId: string | undefined;
  stageId: string | undefined;
  branchKey?: string;
};

export type ReviewFeedbackLanePipelineStageRequest = {
  mode: "pipeline_stage";
  pipelineId: string;
  stageId: string;
  branchKey?: string;
};

export type ReviewFeedbackLaneRequest =
  | ReviewFeedbackLaneBareRequest
  | ReviewFeedbackLanePipelineRequest
  | ReviewFeedbackLanePipelineStageRequest;

export type ReviewFeedbackLaneResolutionStore = Pick<
  StateStore,
  "listRuns" | "findRunsByInvocationId" | "loadPipeline" | "loadRun"
>;

function refuse(code: ReviewFeedbackLaneRefusalCode, message: string): ReviewFeedbackLaneResolutionResult {
  return { ok: false, code, message };
}

function bareLaneKindFromFirstStep(step: WorkflowSnapshotStep | undefined): ReviewFeedbackLaneKind | null {
  if (step == null) return null;
  if (step.promptId === REVIEW_FEEDBACK_WRITE_PROMPT_ID) return null;
  if (step.role === "implement") return "implement";
  if (step.promptId === "intent.prompt.split") return "intent";
  if (step.promptId === "plan.prompt.draft") return "plan";
  return null;
}

export function resolveReviewFeedbackEntrySpecPath(laneKind: ReviewFeedbackLaneKind, entryRun: Run): string {
  if (laneKind === "intent") {
    const landingPaths = entryRun.workflowSnapshot?.steps[0]?.landingInputs?.paths;
    const first = landingPaths?.[0];
    if (first !== undefined) {
      const normalized = first.replace(/\\/g, "/");
      if (normalized.includes("/ready-intents/") || normalized.endsWith("/ready-intents")) {
        return "ready-intents";
      }
    }
    if (entryRun.specPath === "ready-intents" || entryRun.specPath.endsWith("/ready-intents")) {
      return "ready-intents";
    }
  }
  return entryRun.specPath;
}

function pipelineLaneKindFromWorkflow(workflow: string): ReviewFeedbackLaneKind | null {
  if (workflow === "intent" || workflow === "plan" || workflow === "implement") return workflow;
  return null;
}

function runsOnProjectBranch(runs: readonly Run[], project: string, branch: string): Run[] {
  return runs.filter((run) => run.project === project && run.branch === branch);
}

function distinctInvocationEntryRunsOnBranch(
  store: ReviewFeedbackLaneResolutionStore,
  project: string,
  branch: string,
): Run[] {
  const runsOnBranch = runsOnProjectBranch(store.listRuns(), project, branch);
  const seenInvocations = new Set<string>();
  const entryRuns: Run[] = [];
  const seenEntryRunIds = new Set<string>();

  for (const run of runsOnBranch) {
    const invocationId = run.workflowSnapshot?.invocationId;
    if (invocationId !== undefined) {
      if (seenInvocations.has(invocationId)) continue;
      seenInvocations.add(invocationId);
    }
    const entryRunId = resolveInvocationEntryRunId(store, run.id);
    if (seenEntryRunIds.has(entryRunId)) continue;
    const entryRun = store.loadRun(entryRunId);
    if (entryRun === null) continue;
    seenEntryRunIds.add(entryRunId);
    entryRuns.push(entryRun);
  }
  return entryRuns;
}

function hasInFlightRunOnBranch(store: ReviewFeedbackLaneResolutionStore, project: string, branch: string): boolean {
  return runsOnProjectBranch(store.listRuns(), project, branch).some((run) => !isTerminalRunStatus(run.status));
}

type CompletedLaneMatch = {
  entryRun: Run;
  laneKind: ReviewFeedbackLaneKind;
  prNumber: number;
  prUrl: string;
};

function completedLaneMatch(
  store: ReviewFeedbackLaneResolutionStore,
  entryRun: Run,
  laneKind: ReviewFeedbackLaneKind,
): CompletedLaneMatch | null {
  const workflowSnapshot = entryRun.workflowSnapshot ?? null;
  const siblingRuns = workflowSnapshot === null ? [] : store.findRunsByInvocationId(workflowSnapshot.invocationId);
  const { status } = resolveWorkflowRunRollup({
    entryRun,
    workflowSnapshot,
    siblingRuns,
    isLive: false,
  });
  if (status !== "completed") return null;
  const prEvidence = resolvePrEvidenceAcrossInvocation(entryRun, siblingRuns);
  if (prEvidence === undefined) return null;
  return { entryRun, laneKind, prNumber: prEvidence.prNumber, prUrl: prEvidence.prUrl };
}

function targetFromMatch(
  match: CompletedLaneMatch,
  provenance: ReviewFeedbackLaneProvenance,
): ReviewFeedbackLaneTarget {
  const { entryRun, laneKind, prNumber, prUrl } = match;
  return {
    laneKind,
    project: entryRun.project,
    branch: entryRun.branch,
    worktreePath: entryRun.worktreePath,
    prNumber,
    prUrl,
    entryRunId: entryRun.id,
    entrySpecPath: resolveReviewFeedbackEntrySpecPath(laneKind, entryRun),
    baseRef: entryRun.specRef,
    provenance,
  };
}

function resolveBareReviewFeedbackLane(
  store: ReviewFeedbackLaneResolutionStore,
  request: ReviewFeedbackLaneBareRequest,
): ReviewFeedbackLaneResolutionResult {
  const { project, branch } = request;
  if (hasInFlightRunOnBranch(store, project, branch)) {
    return refuse("review_feedback_lane_in_flight", `lane on branch ${branch} is still in flight`);
  }

  const entryRuns = distinctInvocationEntryRunsOnBranch(store, project, branch);
  const matches: CompletedLaneMatch[] = [];
  let sawIneligibleEntry = false;

  for (const entryRun of entryRuns) {
    const laneKind = bareLaneKindFromFirstStep(entryRun.workflowSnapshot?.steps[0]);
    if (laneKind === null) {
      sawIneligibleEntry = true;
      continue;
    }
    const match = completedLaneMatch(store, entryRun, laneKind);
    if (match !== null) matches.push(match);
  }

  if (matches.length === 1) {
    return { ok: true, target: targetFromMatch(matches[0] as CompletedLaneMatch, { kind: "bare" }) };
  }
  if (matches.length > 1) {
    return refuse("review_feedback_lane_ambiguous", `branch ${branch} matches more than one completed lane`);
  }
  if (sawIneligibleEntry) {
    return refuse(
      "review_feedback_lane_not_eligible",
      `branch ${branch} has no eligible intent, plan, or implement lane`,
    );
  }
  return refuse("review_feedback_lane_unmatched", `no completed lane matched branch ${branch}`);
}

function findWorkflowStageDefinition(pipeline: Pipeline, stageId: string): WorkflowPipelineStage | undefined {
  const stage = pipeline.definition.stages.find((candidate) => candidate.stageId === stageId);
  if (stage === undefined || stage.kind !== "workflow") return undefined;
  return stage;
}

function selectPipelineStageRow(
  stages: readonly PipelineStageRecord[],
  stageId: string,
  requestedBranchKey: string | undefined,
): { kind: "stage"; stage: PipelineStageRecord } | { kind: "refusal"; result: ReviewFeedbackLaneResolutionResult } {
  const rows = stages.filter((stage) => stage.stageId === stageId);
  if (rows.length === 0) {
    return {
      kind: "refusal",
      result: refuse("review_feedback_lane_unmatched", `pipeline has no stage ${stageId}`),
    };
  }
  if (rows.length === 1) {
    const stage = rows[0];
    if (stage === undefined) {
      return {
        kind: "refusal",
        result: refuse("review_feedback_lane_unmatched", `pipeline has no stage ${stageId}`),
      };
    }
    return { kind: "stage", stage };
  }
  if (requestedBranchKey === undefined) {
    return {
      kind: "refusal",
      result: refuse("review_feedback_lane_unmatched", "missing required flag --branch-key for fan-out stage"),
    };
  }
  const row = rows.find((stage) => stage.branchKey === requestedBranchKey);
  if (row === undefined) {
    return {
      kind: "refusal",
      result: refuse("review_feedback_lane_unmatched", `no stage ${stageId} row for branch-key ${requestedBranchKey}`),
    };
  }
  return { kind: "stage", stage: row };
}

type PipelineStageBranchBinding = { project: string; branch: string };

function resolvePipelineStageIdentifiedReviewFeedbackLane(
  store: ReviewFeedbackLaneResolutionStore,
  pipelineId: string,
  stageId: string,
  branchKey: string | undefined,
  branchBinding: PipelineStageBranchBinding | undefined,
): ReviewFeedbackLaneResolutionResult {
  if (branchBinding !== undefined && hasInFlightRunOnBranch(store, branchBinding.project, branchBinding.branch)) {
    const { branch } = branchBinding;
    return refuse("review_feedback_lane_in_flight", `lane on branch ${branch} is still in flight`);
  }

  const pipeline = store.loadPipeline(pipelineId);
  if (pipeline === null) {
    return refuse("review_feedback_lane_unmatched", `pipeline ${pipelineId} not found`);
  }

  const stageDef = findWorkflowStageDefinition(pipeline, stageId);
  if (stageDef === undefined) {
    return refuse("review_feedback_lane_unmatched", `pipeline ${pipelineId} has no workflow stage ${stageId}`);
  }
  const laneKind = pipelineLaneKindFromWorkflow(stageDef.workflow);
  if (laneKind === null) {
    return refuse(
      "review_feedback_lane_not_eligible",
      `stage ${stageId} workflow ${stageDef.workflow} is not eligible for review-feedback`,
    );
  }

  const stageSelection = selectPipelineStageRow(pipeline.stages, stageId, branchKey);
  if (stageSelection.kind === "refusal") return stageSelection.result;
  const stageRow = stageSelection.stage;
  if (stageRow.status !== "succeeded") {
    return refuse("review_feedback_lane_unmatched", `stage ${stageId} is not succeeded`);
  }

  const stageLinkedRunId = stageRow.workflowInvocationId;
  if (stageLinkedRunId === null) {
    return refuse("review_feedback_lane_unmatched", `stage ${stageId} has no linked workflow invocation`);
  }

  const canonicalEntryRunId = resolveInvocationEntryRunId(store, stageLinkedRunId);
  const entryRun = store.loadRun(canonicalEntryRunId);
  if (entryRun === null) {
    return refuse("review_feedback_lane_unmatched", `stage ${stageId} has no linked workflow entry run`);
  }

  const project = branchBinding?.project ?? entryRun.project;
  const branch = branchBinding?.branch ?? entryRun.branch;

  if (branchBinding === undefined && hasInFlightRunOnBranch(store, project, branch)) {
    return refuse("review_feedback_lane_in_flight", `lane on branch ${branch} is still in flight`);
  }

  if (
    branchBinding !== undefined &&
    (entryRun.branch !== branchBinding.branch || entryRun.project !== branchBinding.project)
  ) {
    return refuse(
      "review_feedback_lane_unmatched",
      `stage ${stageId} entry run does not match branch ${branchBinding.branch}`,
    );
  }
  const match = completedLaneMatch(store, entryRun, laneKind);
  if (match === null) {
    return refuse("review_feedback_lane_unmatched", `stage ${stageId} lane is not completed with publication evidence`);
  }

  return {
    ok: true,
    target: targetFromMatch(match, {
      kind: "pipeline",
      pipelineId,
      stageId,
      branchKey: stageRow.branchKey,
    }),
  };
}

function resolvePipelineReviewFeedbackLane(
  store: ReviewFeedbackLaneResolutionStore,
  request: ReviewFeedbackLanePipelineRequest,
): ReviewFeedbackLaneResolutionResult {
  if (request.pipelineId === undefined) {
    return refuse("review_feedback_lane_unmatched", "missing required flag --pipeline");
  }
  if (request.stageId === undefined) {
    return refuse("review_feedback_lane_unmatched", "missing required flag --stage");
  }
  const { project, branch, pipelineId, stageId } = request;
  return resolvePipelineStageIdentifiedReviewFeedbackLane(store, pipelineId, stageId, request.branchKey, {
    project,
    branch,
  });
}

export function resolveReviewFeedbackLane(
  store: ReviewFeedbackLaneResolutionStore,
  request: ReviewFeedbackLaneRequest,
): ReviewFeedbackLaneResolutionResult {
  if (request.mode === "bare") {
    return resolveBareReviewFeedbackLane(store, request);
  }
  if (request.mode === "pipeline_stage") {
    return resolvePipelineStageIdentifiedReviewFeedbackLane(
      store,
      request.pipelineId,
      request.stageId,
      request.branchKey,
      undefined,
    );
  }
  return resolvePipelineReviewFeedbackLane(store, request);
}
