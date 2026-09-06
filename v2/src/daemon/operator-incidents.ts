import { ATTENTION_TERMINAL_RECENCY_MS } from "../attention-terminal-recency.ts";
import type { Pipeline, PipelineStageRecord, Run, StateStore } from "../persistence/state-store.ts";
import { isTerminalRunStatus, RUN_STATUSES } from "../persistence/state-store.ts";
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
  | "stage-failed"
  | "publication-failure"
  | "run-blocked"
  | "run-budget-soft-stopped"
  | "run-ad-hoc-terminal";

/** One operator-actionable incident at derived altitude. */
export type OperatorIncident = {
  incidentId: string;
  kind: OperatorIncidentKind;
  transition: string;
  project: string | null;
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

type IncidentKey = { incidentId: string; transition: string };

function deliveredIncidentKey(incidentId: string, transition: string): string {
  return `${incidentId}\0${transition}`;
}

function isDeliveredIncident(delivered: ReadonlySet<string>, incidentId: string, transition: string): boolean {
  return delivered.has(deliveredIncidentKey(incidentId, transition));
}

function onlyDeliveredIncidents(delivered: ReadonlySet<string>, incidents: readonly IncidentKey[]): boolean {
  if (incidents.length === 0) return false;
  return incidents.every((incident) => isDeliveredIncident(delivered, incident.incidentId, incident.transition));
}

function collectCandidateIncidentIds(
  pipelines: readonly (Pipeline & { stages: PipelineStageRecord[] })[],
  runs: readonly Run[],
): string[] {
  const incidentIds = new Set<string>();
  for (const pipeline of pipelines) {
    incidentIds.add(pipelineIncidentId(pipeline.id));
    for (const stage of pipeline.stages) {
      incidentIds.add(stageIncidentId(pipeline.id, stage.stageId, stage.branchKey));
    }
  }
  for (const run of runs) {
    incidentIds.add(runIncidentId(run.id));
  }
  return [...incidentIds];
}

function loadDeliveredIncidentKeys(store: StateStore, incidentIds: readonly string[]): Set<string> {
  const delivered = new Set<string>();
  for (const row of store.listNotificationDeliveriesForIncidentIds(incidentIds)) {
    delivered.add(deliveredIncidentKey(row.incidentId, row.transition));
  }
  return delivered;
}

function previewPipelineIncidentKeys(
  store: StateStore,
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
): IncidentKey[] {
  const keys: IncidentKey[] = [];
  const state = derivePipelineState(pipeline);
  const boundary = derivePipelineBoundary(pipeline);

  if (boundary?.kind === "awaiting-approval") {
    keys.push({
      incidentId: pipelineIncidentId(pipeline.id),
      transition: `awaiting-approval:${boundary.stageId}:${boundary.branchKey}`,
    });
  }

  if (isPipelineTerminal(state)) {
    if (hasPipelineTerminalPublicationFailure(pipeline)) {
      keys.push({ incidentId: pipelineIncidentId(pipeline.id), transition: "publication-failed" });
    } else {
      keys.push({ incidentId: pipelineIncidentId(pipeline.id), transition: `terminal:${state}` });
    }
  }

  for (const stage of pipeline.stages) {
    if (redrivableDeferredSettlementEntryRunId(store, stage) !== undefined) {
      keys.push({
        incidentId: stageIncidentId(pipeline.id, stage.stageId, stage.branchKey),
        transition: "settlement_deferred:entry_run_dead",
      });
    }
  }

  if (!isPipelineTerminal(state)) {
    for (const stage of pipeline.stages) {
      if (stage.status === "failed") {
        keys.push({
          incidentId: stageIncidentId(pipeline.id, stage.stageId, stage.branchKey),
          transition: "failed",
        });
      }
    }
  }

  return keys;
}

function previewRunIncidentKeys(
  run: Run,
  suppressedInvocationIds: ReadonlySet<string>,
  pipelineAttributedRunIds: ReadonlySet<string>,
): IncidentKey[] {
  const invocationId = run.workflowSnapshot?.invocationId;
  if (invocationId !== undefined && suppressedInvocationIds.has(invocationId)) {
    return [];
  }

  if (run.status === "budget-soft-stopped") {
    return [{ incidentId: runIncidentId(run.id), transition: "budget-soft-stopped" }];
  }
  if (run.status === "blocked") {
    return [{ incidentId: runIncidentId(run.id), transition: "blocked" }];
  }
  if (run.workflowSnapshot !== undefined && !pipelineAttributedRunIds.has(run.id) && isTerminalRunStatus(run.status)) {
    return [{ incidentId: runIncidentId(run.id), transition: `terminal:${run.status}` }];
  }
  return [];
}

function pushUndeliveredIncident(
  incidents: OperatorIncident[],
  delivered: ReadonlySet<string>,
  incident: OperatorIncident,
): void {
  if (isDeliveredIncident(delivered, incident.incidentId, incident.transition)) return;
  incidents.push(incident);
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
  stage: PipelineStageRecord,
  entryRunsById: ReadonlyMap<string, Run>,
  suppressedInvocationIds: Set<string>,
): void {
  const entryRunId = stage.workflowInvocationId;
  if (entryRunId === null) return;
  const entryRun = entryRunsById.get(entryRunId);
  const invocationId = entryRun?.workflowSnapshot?.invocationId;
  if (invocationId !== undefined) suppressedInvocationIds.add(invocationId);
}

function collectEntryRunIds(pipelines: readonly (Pipeline & { stages: PipelineStageRecord[] })[]): Set<string> {
  const entryRunIds = new Set<string>();
  for (const pipeline of pipelines) {
    for (const stage of pipeline.stages) {
      const entryRunId = stage.workflowInvocationId;
      if (entryRunId !== null) entryRunIds.add(entryRunId);
    }
  }
  return entryRunIds;
}

function loadStageAttributedLookups(
  store: StateStore,
  pipelines: readonly (Pipeline & { stages: PipelineStageRecord[] })[],
): { entryRunsById: Map<string, Run>; pipelineAttributedRunIds: Set<string> } {
  const entryRunIds = collectEntryRunIds(pipelines);
  const entryRunsById = new Map<string, Run>();
  for (const run of store.loadRunsByIds([...entryRunIds])) {
    entryRunsById.set(run.id, run);
  }

  const invocationIds = new Set<string>();
  for (const run of entryRunsById.values()) {
    const invocationId = run.workflowSnapshot?.invocationId;
    if (invocationId !== undefined) invocationIds.add(invocationId);
  }

  const pipelineAttributedRunIds = new Set<string>(entryRunIds);
  for (const run of store.findRunsByInvocationIds([...invocationIds])) {
    pipelineAttributedRunIds.add(run.id);
  }

  return { entryRunsById, pipelineAttributedRunIds };
}

function resolvePipelineIncidentProject(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  entryRunsById: ReadonlyMap<string, Run>,
): string | null {
  const projects = new Set<string>();
  for (const stage of pipeline.stages) {
    const entryRunId = stage.workflowInvocationId;
    if (entryRunId === null) continue;
    const entryRun = entryRunsById.get(entryRunId);
    if (entryRun === undefined) continue;
    if (entryRun.project !== "") projects.add(entryRun.project);
  }
  if (projects.size !== 1) return null;
  return [...projects][0] ?? null;
}

function pushAwaitingApprovalIncident(
  incidents: OperatorIncident[],
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  boundary: Extract<PipelineBoundaryResult, { kind: "awaiting-approval" }>,
  project: string | null,
): void {
  incidents.push({
    incidentId: pipelineIncidentId(pipeline.id),
    kind: "pipeline-awaiting-approval",
    transition: `awaiting-approval:${boundary.stageId}:${boundary.branchKey}`,
    project,
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
  project: string | null,
): void {
  incidents.push({
    incidentId: pipelineIncidentId(pipeline.id),
    kind: "pipeline-terminal",
    transition: `terminal:${state}`,
    project,
    pipelineId: pipeline.id,
    cause: state,
    sinceMs: pipelineTerminalSinceMs(pipeline),
  });
}

function pushPublicationFailureIncident(
  incidents: OperatorIncident[],
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  project: string | null,
): void {
  incidents.push({
    incidentId: pipelineIncidentId(pipeline.id),
    kind: "publication-failure",
    transition: "publication-failed",
    project,
    pipelineId: pipeline.id,
    cause: pipeline.terminalPublicationFailure?.failure.operation ?? "publication_failed",
    sinceMs: pipelineTerminalSinceMs(pipeline),
  });
}

function pushStageFailedIncident(
  incidents: OperatorIncident[],
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  stage: PipelineStageRecord,
  project: string | null,
): void {
  incidents.push({
    incidentId: stageIncidentId(pipeline.id, stage.stageId, stage.branchKey),
    kind: "stage-failed",
    transition: "failed",
    project,
    pipelineId: pipeline.id,
    stageId: stage.stageId,
    branchKey: stage.branchKey,
    cause: "failed",
    sinceMs: stageSinceMs(stage),
  });
}

function collectPipelineIncidents(
  store: StateStore,
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  entryRunsById: ReadonlyMap<string, Run>,
): { incidents: OperatorIncident[]; suppressedInvocationIds: Set<string> } {
  const incidents: OperatorIncident[] = [];
  const suppressedInvocationIds = new Set<string>();
  const state = derivePipelineState(pipeline);
  const boundary = derivePipelineBoundary(pipeline);
  const project = resolvePipelineIncidentProject(pipeline, entryRunsById);

  if (boundary?.kind === "awaiting-approval") {
    pushAwaitingApprovalIncident(incidents, pipeline, boundary, project);
  }

  if (isPipelineTerminal(state)) {
    if (hasPipelineTerminalPublicationFailure(pipeline)) {
      pushPublicationFailureIncident(incidents, pipeline, project);
    } else {
      pushPipelineTerminalIncident(incidents, pipeline, state, project);
    }
    for (const stage of pipeline.stages) {
      if (stage.status === "failed") {
        addSuppressedInvocationForFailedStage(stage, entryRunsById, suppressedInvocationIds);
      }
    }
  }

  for (const stage of pipeline.stages) {
    if (redrivableDeferredSettlementEntryRunId(store, stage) !== undefined) {
      incidents.push({
        incidentId: stageIncidentId(pipeline.id, stage.stageId, stage.branchKey),
        kind: "stage-settlement-wedged",
        transition: "settlement_deferred:entry_run_dead",
        project,
        pipelineId: pipeline.id,
        stageId: stage.stageId,
        branchKey: stage.branchKey,
        cause: "settlement_deferred",
        sinceMs: stageSinceMs(stage),
      });
    }
  }

  if (!isPipelineTerminal(state)) {
    for (const stage of pipeline.stages) {
      if (stage.status === "failed") {
        pushStageFailedIncident(incidents, pipeline, stage, project);
        addSuppressedInvocationForFailedStage(stage, entryRunsById, suppressedInvocationIds);
      }
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
    project: run.project,
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
export function deriveOperatorIncidents(store: StateStore, nowMs: number = Date.now()): OperatorIncident[] {
  const sinceMs = nowMs - ATTENTION_TERMINAL_RECENCY_MS;
  const candidatePipelines = store.listIncidentCandidatePipelines({ sinceMs });
  const candidateRuns = store.listIncidentCandidateRuns({ statuses: RUN_STATUSES, sinceMs });
  const delivered = loadDeliveredIncidentKeys(store, collectCandidateIncidentIds(candidatePipelines, candidateRuns));

  const activePipelines = candidatePipelines.filter(
    (pipeline) => !onlyDeliveredIncidents(delivered, previewPipelineIncidentKeys(store, pipeline)),
  );

  const needsRunAttribution = candidateRuns.some(
    (run) => run.workflowSnapshot !== undefined && isTerminalRunStatus(run.status),
  );
  const { entryRunsById, pipelineAttributedRunIds } =
    activePipelines.length > 0 || needsRunAttribution
      ? loadStageAttributedLookups(store, candidatePipelines)
      : { entryRunsById: new Map<string, Run>(), pipelineAttributedRunIds: new Set<string>() };

  const incidents: OperatorIncident[] = [];
  const suppressedInvocationIds = new Set<string>();

  for (const pipeline of activePipelines) {
    const pipelineIncidents = collectPipelineIncidents(store, pipeline, entryRunsById);
    for (const incident of pipelineIncidents.incidents) {
      pushUndeliveredIncident(incidents, delivered, incident);
    }
    for (const invocationId of pipelineIncidents.suppressedInvocationIds) {
      suppressedInvocationIds.add(invocationId);
    }
  }

  const runsForCollection = candidateRuns.filter((run) => {
    const keys = previewRunIncidentKeys(run, suppressedInvocationIds, pipelineAttributedRunIds);
    return keys.length > 0 && !onlyDeliveredIncidents(delivered, keys);
  });

  for (const incident of collectRunIncidents(runsForCollection, suppressedInvocationIds, pipelineAttributedRunIds)) {
    pushUndeliveredIncident(incidents, delivered, incident);
  }

  return incidents;
}

/** JSON shape written to the configured notification sink on stdin. */
export function serializeOperatorIncident(incident: OperatorIncident): string {
  return JSON.stringify({
    incidentId: incident.incidentId,
    kind: incident.kind,
    transition: incident.transition,
    project: incident.project,
    pipelineId: incident.pipelineId ?? null,
    stageId: incident.stageId ?? null,
    branchKey: incident.branchKey ?? null,
    runId: incident.runId ?? null,
    cause: incident.cause ?? null,
    sinceMs: incident.sinceMs,
  });
}
