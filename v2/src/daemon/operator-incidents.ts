import type { Pipeline, PipelineStageRecord, Run, StateStore } from "../persistence/state-store.ts";
import { isTerminalRunStatus } from "../persistence/state-store.ts";
import {
  derivePipelineState,
  hasPipelineTerminalPublicationFailure,
  isPipelineTerminal,
  type PipelineDerivedState,
} from "./pipeline-execution.ts";
import { derivePipelineBoundary, type PipelineBoundaryResult } from "./pipeline-observation.ts";
import { redrivableDeferredSettlementEntryRunId } from "./pipeline-stage-dispatch.ts";

export type OperatorIncidentKind =
  | "pipeline-awaiting-approval"
  | "pipeline-terminal"
  | "stage-settlement-wedged"
  | "publication-failure"
  | "run-blocked"
  | "run-budget-soft-stopped"
  | "run-ad-hoc-terminal";

/** One operator-actionable incident at derived altitude. */
export type OperatorIncident = {
  incidentId: string;
  kind: OperatorIncidentKind;
  transition: string;
  pipelineId?: string;
  stageId?: string;
  branchKey?: string;
  runId?: string;
  cause?: string;
  sinceMs: number | null;
};

function pipelineIncidentId(pipelineId: string): string {
  return `pipeline:${pipelineId}`;
}

function stageIncidentId(pipelineId: string, stageId: string, branchKey: string): string {
  return `stage:${pipelineId}:${stageId}:${branchKey}`;
}

function runIncidentId(runId: string): string {
  return `run:${runId}`;
}

function stageSinceMs(stage: PipelineStageRecord): number | null {
  return stage.endedAt ?? stage.decidedAt ?? stage.startedAt;
}

function pipelineTerminalSinceMs(pipeline: Pipeline & { stages: PipelineStageRecord[] }): number | null {
  const finishAts = pipeline.stages
    .flatMap((stage) => [stage.endedAt, stage.decidedAt])
    .filter((value): value is number => value !== null);
  if (finishAts.length > 0) return Math.max(...finishAts);
  if (pipeline.terminalPublicationSucceededAt !== null) return pipeline.terminalPublicationSucceededAt;
  return pipeline.createdAt;
}

function addSuppressedInvocationForFailedStage(
  store: StateStore,
  stage: PipelineStageRecord,
  suppressedInvocationIds: Set<string>,
): void {
  const entryRunId = stage.workflowInvocationId;
  if (entryRunId === null) return;
  const entryRun = store.loadRun(entryRunId);
  const invocationId = entryRun?.workflowSnapshot?.invocationId;
  if (invocationId !== undefined) suppressedInvocationIds.add(invocationId);
}

function collectPipelineAttributedRunIds(store: StateStore): Set<string> {
  const runIds = new Set<string>();
  for (const pipeline of store.listPipelines()) {
    for (const stage of pipeline.stages) {
      const entryRunId = stage.workflowInvocationId;
      if (entryRunId === null) continue;
      runIds.add(entryRunId);
      const entryRun = store.loadRun(entryRunId);
      const invocationId = entryRun?.workflowSnapshot?.invocationId;
      if (invocationId === undefined) continue;
      for (const run of store.findRunsByInvocationId(invocationId)) {
        runIds.add(run.id);
      }
    }
  }
  return runIds;
}

function pushAwaitingApprovalIncident(
  incidents: OperatorIncident[],
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  boundary: Extract<PipelineBoundaryResult, { kind: "awaiting-approval" }>,
): void {
  incidents.push({
    incidentId: pipelineIncidentId(pipeline.id),
    kind: "pipeline-awaiting-approval",
    transition: `awaiting-approval:${boundary.stageId}:${boundary.branchKey}`,
    pipelineId: pipeline.id,
    stageId: boundary.stageId,
    branchKey: boundary.branchKey,
    sinceMs:
      pipeline.stages.find((stage) => stage.stageId === boundary.stageId && stage.branchKey === boundary.branchKey)
        ?.decidedAt ?? null,
  });
}

function pushPipelineTerminalIncident(
  incidents: OperatorIncident[],
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  state: PipelineDerivedState,
): void {
  incidents.push({
    incidentId: pipelineIncidentId(pipeline.id),
    kind: "pipeline-terminal",
    transition: `terminal:${state}`,
    pipelineId: pipeline.id,
    cause: state,
    sinceMs: pipelineTerminalSinceMs(pipeline),
  });
}

function pushPublicationFailureIncident(
  incidents: OperatorIncident[],
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
): void {
  incidents.push({
    incidentId: pipelineIncidentId(pipeline.id),
    kind: "publication-failure",
    transition: "publication-failed",
    pipelineId: pipeline.id,
    cause: pipeline.terminalPublicationFailure?.failure.operation ?? "publication_failed",
    sinceMs: pipelineTerminalSinceMs(pipeline),
  });
}

function collectPipelineIncidents(
  store: StateStore,
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
): { incidents: OperatorIncident[]; suppressedInvocationIds: Set<string> } {
  const incidents: OperatorIncident[] = [];
  const suppressedInvocationIds = new Set<string>();
  const state = derivePipelineState(pipeline);
  const boundary = derivePipelineBoundary(pipeline);

  if (boundary?.kind === "awaiting-approval") {
    pushAwaitingApprovalIncident(incidents, pipeline, boundary);
  }

  if (isPipelineTerminal(state)) {
    if (hasPipelineTerminalPublicationFailure(pipeline)) {
      pushPublicationFailureIncident(incidents, pipeline);
    } else {
      pushPipelineTerminalIncident(incidents, pipeline, state);
    }
    for (const stage of pipeline.stages) {
      if (stage.status === "failed") {
        addSuppressedInvocationForFailedStage(store, stage, suppressedInvocationIds);
      }
    }
  }

  for (const stage of pipeline.stages) {
    if (redrivableDeferredSettlementEntryRunId(store, stage) !== undefined) {
      incidents.push({
        incidentId: stageIncidentId(pipeline.id, stage.stageId, stage.branchKey),
        kind: "stage-settlement-wedged",
        transition: "settlement_deferred:entry_run_dead",
        pipelineId: pipeline.id,
        stageId: stage.stageId,
        branchKey: stage.branchKey,
        cause: "settlement_deferred",
        sinceMs: stageSinceMs(stage),
      });
    }
  }

  return { incidents, suppressedInvocationIds };
}

function pushRunIncident(
  incidents: OperatorIncident[],
  run: Run,
  kind: OperatorIncidentKind,
  transition: string,
): void {
  incidents.push({
    incidentId: runIncidentId(run.id),
    kind,
    transition,
    runId: run.id,
    cause: run.status,
    sinceMs: run.finishedAt ?? run.createdAt,
  });
}

function collectRunIncidents(
  runs: readonly Run[],
  suppressedInvocationIds: ReadonlySet<string>,
  pipelineAttributedRunIds: ReadonlySet<string>,
): OperatorIncident[] {
  const incidents: OperatorIncident[] = [];
  for (const run of runs) {
    const invocationId = run.workflowSnapshot?.invocationId;
    if (invocationId !== undefined && suppressedInvocationIds.has(invocationId)) {
      continue;
    }

    if (run.status === "budget-soft-stopped") {
      pushRunIncident(incidents, run, "run-budget-soft-stopped", "budget-soft-stopped");
      continue;
    }
    if (run.status === "blocked") {
      pushRunIncident(incidents, run, "run-blocked", "blocked");
      continue;
    }
    if (
      run.workflowSnapshot !== undefined &&
      !pipelineAttributedRunIds.has(run.id) &&
      isTerminalRunStatus(run.status)
    ) {
      pushRunIncident(incidents, run, "run-ad-hoc-terminal", `terminal:${run.status}`);
    }
  }
  return incidents;
}

/** Recompute every current operator-actionable incident from durable rows. */
export function deriveOperatorIncidents(store: StateStore): OperatorIncident[] {
  const incidents: OperatorIncident[] = [];
  const suppressedInvocationIds = new Set<string>();

  for (const pipeline of store.listPipelines()) {
    const pipelineIncidents = collectPipelineIncidents(store, pipeline);
    incidents.push(...pipelineIncidents.incidents);
    for (const invocationId of pipelineIncidents.suppressedInvocationIds) {
      suppressedInvocationIds.add(invocationId);
    }
  }

  const pipelineAttributedRunIds = collectPipelineAttributedRunIds(store);
  incidents.push(...collectRunIncidents(store.listRuns(), suppressedInvocationIds, pipelineAttributedRunIds));
  return incidents;
}

/** JSON shape written to the configured notification sink on stdin. */
export function serializeOperatorIncident(incident: OperatorIncident): string {
  return JSON.stringify({
    incidentId: incident.incidentId,
    kind: incident.kind,
    transition: incident.transition,
    pipelineId: incident.pipelineId ?? null,
    stageId: incident.stageId ?? null,
    branchKey: incident.branchKey ?? null,
    runId: incident.runId ?? null,
    cause: incident.cause ?? null,
    sinceMs: incident.sinceMs,
  });
}
