import { ATTENTION_TERMINAL_RECENCY_MS } from "../attention-terminal-recency.ts";
import type { PipelineStageArtifact } from "../persistence/pipeline-stage-settlement.ts";
import type { Pipeline, PipelineStageRecord, Run, StateStore } from "../persistence/state-store.ts";
import { isTerminalRunStatus, RUN_STATUSES } from "../persistence/state-store.ts";
import {
  derivePipelineState,
  hasPipelineTerminalPublicationFailure,
  isPipelineTerminal,
  type PipelineDerivedState,
} from "./pipeline-execution.ts";
import { derivePipelineAwaitingGates } from "./pipeline-observation.ts";

type OperatorIncidentKind =
  | "pipeline-awaiting-approval"
  | "pipeline-terminal"
  | "stage-failed"
  | "stage-succeeded"
  | "publication-failure"
  | "run-blocked"
  | "run-budget-soft-stopped"
  | "run-paused"
  | "run-ad-hoc-terminal"
  | "run-timeout";

/**
 * Version of the `(incidentId, transition)` key format. Bump whenever a transition string
 * changes shape or a new incident kind is added; `reconcileNotificationKeyFormat` then marks
 * already-settled incidents delivered under the new format instead of re-sending them.
 */
export const NOTIFICATION_KEY_FORMAT_VERSION = 4;

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
  prNumber?: number;
  prUrl?: string;
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

type DeliveredLedger = { keys: Set<string>; transitionsByIncident: Map<string, string[]> };

function loadDeliveredLedger(store: StateStore, incidentIds: readonly string[]): DeliveredLedger {
  const keys = new Set<string>();
  const transitionsByIncident = new Map<string, string[]>();
  for (const row of store.listNotificationDeliveriesForIncidentIds(incidentIds)) {
    keys.add(deliveredIncidentKey(row.incidentId, row.transition));
    transitionsByIncident.set(row.incidentId, [...(transitionsByIncident.get(row.incidentId) ?? []), row.transition]);
  }
  return { keys, transitionsByIncident };
}

function loadDeliveredIncidentKeys(store: StateStore, incidentIds: readonly string[]): Set<string> {
  return loadDeliveredLedger(store, incidentIds).keys;
}

/** Reopened failed stages reuse their row; the settlement time separates each failure from the last. */
function stageFailedTransition(stage: PipelineStageRecord): string {
  return `failed:${stage.endedAt ?? stage.startedAt ?? 0}`;
}

/** True when the stage's admitted definition entry is a workflow stage running the `implement` workflow. */
function isImplementWorkflowStage(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  stage: PipelineStageRecord,
): boolean {
  const definitionStage = pipeline.definition.stages.find((s) => s.stageId === stage.stageId);
  return definitionStage?.kind === "workflow" && definitionStage.workflow === "implement";
}

/** Resumed lanes reuse their row; a null `endedAt` on a succeeded row emits no incident rather than falling back. */
function stageSucceededTransition(stage: PipelineStageRecord): string | undefined {
  return stage.endedAt === null ? undefined : `succeeded:${stage.endedAt}`;
}

/** Same narrowing `pipeline-execution.ts` applies before reading artifact PR fields. */
function narrowStageArtifact(artifact: unknown): PipelineStageArtifact | undefined {
  return artifact !== null &&
    typeof artifact === "object" &&
    typeof (artifact as PipelineStageArtifact).entryRunId === "string" &&
    typeof (artifact as PipelineStageArtifact).specPath === "string"
    ? (artifact as PipelineStageArtifact)
    : undefined;
}

/**
 * When the gate row durably entered `awaiting`. Rows stamped before the `awaiting_since` column
 * existed fall back to the latest settlement among the gate's branch-suffix predecessors.
 */
function gateReachedAt(pipeline: Pipeline & { stages: PipelineStageRecord[] }, gate: PipelineStageRecord): number {
  if (gate.awaitingSince != null) return gate.awaitingSince;
  let reachedAt = pipeline.createdAt;
  for (const stage of pipeline.stages) {
    if (stage.position >= gate.position) continue;
    if (stage.branchKey !== gate.branchKey && stage.branchKey !== "default") continue;
    const settledAt = stage.endedAt ?? stage.decidedAt;
    if (settledAt !== null && settledAt > reachedAt) reachedAt = settledAt;
  }
  return reachedAt;
}

function awaitingGateTransition(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  gate: PipelineStageRecord,
): string {
  return `awaiting-approval:${gate.stageId}:${gate.branchKey}:${gateReachedAt(pipeline, gate)}`;
}

/**
 * Every reachable gate, `awaiting` or still `pending`. A pending row keys on the predecessor
 * fallback until the boundary commit stamps `awaiting_since`; a continuation that never flips it
 * (`continuePipeline` after settlement is fire-and-forget) must not go silent, so the rare sweep
 * tick inside that window costs a duplicate rather than a miss.
 */
function reachableGates(pipeline: Pipeline & { stages: PipelineStageRecord[] }): PipelineStageRecord[] {
  return derivePipelineAwaitingGates(pipeline).map((gate) => gate.record);
}

function previewPipelineIncidentKeys(
  store: StateStore,
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
): IncidentKey[] {
  const keys: IncidentKey[] = [];
  const state = derivePipelineState(pipeline);

  for (const gate of reachableGates(pipeline)) {
    keys.push({
      incidentId: pipelineIncidentId(pipeline.id),
      transition: awaitingGateTransition(pipeline, gate),
    });
  }

  if (isPipelineTerminal(state)) {
    if (hasPipelineTerminalPublicationFailure(pipeline)) {
      keys.push({ incidentId: pipelineIncidentId(pipeline.id), transition: "publication-failed" });
    } else {
      keys.push({ incidentId: pipelineIncidentId(pipeline.id), transition: `terminal:${state}` });
    }
  }

  if (!isPipelineTerminal(state)) {
    for (const stage of pipeline.stages) {
      if (stage.status === "failed") {
        keys.push({
          incidentId: stageIncidentId(pipeline.id, stage.stageId, stage.branchKey),
          transition: stageFailedTransition(stage),
        });
      }
      if (stage.status === "succeeded" && isImplementWorkflowStage(pipeline, stage)) {
        const transition = stageSucceededTransition(stage);
        if (transition !== undefined) {
          keys.push({ incidentId: stageIncidentId(pipeline.id, stage.stageId, stage.branchKey), transition });
        }
      }
    }
  }

  return keys;
}

/** A `run_timeout` settlement not owned by a pipeline stage: workflow and direct write-loop rows alike. */
function isUnattributedRunTimeout(run: Run, pipelineAttributedRunIds: ReadonlySet<string>): boolean {
  return run.terminalCause === "run_timeout" && run.status === "killed" && !pipelineAttributedRunIds.has(run.id);
}

/** Stage failure cause: `run_timeout` when the stage's entry settled by the whole-run timeout. */
function stageFailedCause(stage: PipelineStageRecord): string {
  const detail = stage.failureDetail as { terminalCause?: unknown } | null | undefined;
  return detail?.terminalCause === "run_timeout" ? "run_timeout" : "failed";
}

/** Resumed runs reuse their row; the status-write timestamp separates each settlement from the last. */
function statusChangeTransition(run: Run, prefix: string): string {
  return `${prefix}:${run.statusChangedAt ?? run.createdAt}`;
}

function resumableStopTransition(run: Run): string {
  return statusChangeTransition(run, run.status);
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
    return [{ incidentId: runIncidentId(run.id), transition: resumableStopTransition(run) }];
  }
  if (run.status === "blocked") {
    return [{ incidentId: runIncidentId(run.id), transition: statusChangeTransition(run, "blocked") }];
  }
  if (run.status === "paused") {
    return [{ incidentId: runIncidentId(run.id), transition: resumableStopTransition(run) }];
  }
  if (isUnattributedRunTimeout(run, pipelineAttributedRunIds)) {
    return [{ incidentId: runIncidentId(run.id), transition: statusChangeTransition(run, "run_timeout") }];
  }
  if (isPlainRun(run) && isTerminalRunStatus(run.status)) {
    return [{ incidentId: runIncidentId(run.id), transition: statusChangeTransition(run, `terminal:${run.status}`) }];
  }
  return [];
}

/** A `run start` row: no workflow snapshot, so no invocation to roll up to and never pipeline-attributed. */
function isPlainRun(run: Run): boolean {
  return run.workflowSnapshot?.invocationId === undefined;
}

type InvocationSettledMarker = NonNullable<ReturnType<StateStore["readWorkflowInvocationSettledMarker"]>>;

type WorkflowInvocationRows = { invocationId: string; entryRun: Run; rows: Run[]; marker: InvocationSettledMarker };

function isInvocationRollupCandidate(
  run: Run,
  suppressedInvocationIds: ReadonlySet<string>,
  pipelineAttributedRunIds: ReadonlySet<string>,
): boolean {
  const invocationId = run.workflowSnapshot?.invocationId;
  return (
    invocationId !== undefined &&
    !suppressedInvocationIds.has(invocationId) &&
    !pipelineAttributedRunIds.has(run.id) &&
    isTerminalRunStatus(run.status)
  );
}

/** The invocation's entry row: the first authored step's row, else the earliest created. */
function findInvocationEntryRun(rows: readonly Run[]): Run | undefined {
  const entryStepId = rows[0]?.workflowSnapshot?.steps[0]?.stepId;
  return (
    rows.find((run) => run.stepId === entryStepId) ??
    rows.reduce<Run | undefined>(
      (earliest, run) => (earliest === undefined || run.createdAt < earliest.createdAt ? run : earliest),
      undefined,
    )
  );
}

/** Each marker write is one settle; row writes never mint a transition. */
function terminalTransition(marker: InvocationSettledMarker): string {
  return `terminal:${marker.cause}:${marker.settledAt}`;
}

/** The candidate rows' entry row, when it is itself a candidate; otherwise the invocation's siblings must load. */
function findCandidateEntryRun(candidateRows: readonly Run[]): Run | undefined {
  const entryStepId = candidateRows[0]?.workflowSnapshot?.steps[0]?.stepId;
  return candidateRows.find((run) => run.stepId === entryStepId);
}

/**
 * Group every candidate terminal workflow row's invocation with all of its durable rows. Invocations
 * without a settled marker, or whose marker settle the ledger already shows delivered, are skipped so
 * the per-tick sibling load stays proportional to undelivered work, not to history inside the recency
 * window.
 */
function collectWorkflowInvocations(
  store: StateStore,
  runs: readonly Run[],
  ledger: DeliveredLedger,
  suppressedInvocationIds: ReadonlySet<string>,
  pipelineAttributedRunIds: ReadonlySet<string>,
): WorkflowInvocationRows[] {
  const candidateRowsByInvocation = new Map<string, Run[]>();
  for (const run of runs) {
    const invocationId = run.workflowSnapshot?.invocationId;
    if (
      invocationId !== undefined &&
      isInvocationRollupCandidate(run, suppressedInvocationIds, pipelineAttributedRunIds)
    ) {
      candidateRowsByInvocation.set(invocationId, [...(candidateRowsByInvocation.get(invocationId) ?? []), run]);
    }
  }
  const invocationIds = new Set<string>();
  const markersByInvocation = new Map<string, InvocationSettledMarker>();
  for (const [invocationId, candidateRows] of candidateRowsByInvocation) {
    const entryRun = findCandidateEntryRun(candidateRows);
    if (entryRun === undefined) {
      invocationIds.add(invocationId);
      continue;
    }
    const marker = store.readWorkflowInvocationSettledMarker(entryRun.id);
    if (marker === null) continue;
    const transitions = ledger.transitionsByIncident.get(runIncidentId(entryRun.id)) ?? [];
    if (transitions.includes(terminalTransition(marker))) continue;
    markersByInvocation.set(invocationId, marker);
    invocationIds.add(invocationId);
  }
  if (invocationIds.size === 0) return [];

  const rowsByInvocation = new Map<string, Run[]>();
  for (const row of store.findRunsByInvocationIds([...invocationIds])) {
    const invocationId = row.workflowSnapshot?.invocationId;
    if (invocationId === undefined) continue;
    rowsByInvocation.set(invocationId, [...(rowsByInvocation.get(invocationId) ?? []), row]);
  }

  const invocations: WorkflowInvocationRows[] = [];
  for (const [invocationId, rows] of rowsByInvocation) {
    const entryRun = findInvocationEntryRun(rows);
    if (entryRun === undefined) continue;
    const marker = markersByInvocation.get(invocationId) ?? store.readWorkflowInvocationSettledMarker(entryRun.id);
    if (marker !== null) invocations.push({ invocationId, entryRun, rows, marker });
  }
  return invocations;
}

/** `blocked` and `run_timeout` rows already carry their own per-row kinds; a timed-out invocation settles `failed`. */
function hasOwnIncidentRow(rows: readonly Run[]): boolean {
  return rows.some((run) => run.status === "blocked" || run.terminalCause === "run_timeout");
}

function collectInvocationIncidents(invocations: readonly WorkflowInvocationRows[]): OperatorIncident[] {
  const incidents: OperatorIncident[] = [];
  for (const { entryRun, rows, marker } of invocations) {
    if (hasOwnIncidentRow(rows)) continue;
    incidents.push({
      incidentId: runIncidentId(entryRun.id),
      kind: "run-ad-hoc-terminal",
      transition: terminalTransition(marker),
      project: entryRun.project,
      runId: entryRun.id,
      cause: marker.cause,
      sinceMs: marker.settledAt,
    });
  }
  return incidents;
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
  gate: PipelineStageRecord,
  project: string | null,
): void {
  incidents.push({
    incidentId: pipelineIncidentId(pipeline.id),
    kind: "pipeline-awaiting-approval",
    transition: awaitingGateTransition(pipeline, gate),
    project,
    pipelineId: pipeline.id,
    stageId: gate.stageId,
    branchKey: gate.branchKey,
    sinceMs: gateReachedAt(pipeline, gate),
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
    cause: pipeline.stages.some((stage) => stage.status === "failed" && stageFailedCause(stage) === "run_timeout")
      ? "run_timeout"
      : state,
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

function pushStageSucceededIncident(
  incidents: OperatorIncident[],
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  stage: PipelineStageRecord,
  project: string | null,
): void {
  const transition = stageSucceededTransition(stage);
  if (transition === undefined) return;
  const artifact = narrowStageArtifact(stage.artifact);
  incidents.push({
    incidentId: stageIncidentId(pipeline.id, stage.stageId, stage.branchKey),
    kind: "stage-succeeded",
    transition,
    project,
    pipelineId: pipeline.id,
    stageId: stage.stageId,
    branchKey: stage.branchKey,
    ...(artifact?.prNumber !== undefined ? { prNumber: artifact.prNumber } : {}),
    ...(artifact?.prUrl !== undefined ? { prUrl: artifact.prUrl } : {}),
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
  const project = resolvePipelineIncidentProject(pipeline, entryRunsById);

  for (const gate of reachableGates(pipeline)) {
    pushAwaitingApprovalIncident(incidents, pipeline, gate, project);
  }

  if (isPipelineTerminal(state)) {
    if (hasPipelineTerminalPublicationFailure(pipeline)) {
      pushPublicationFailureIncident(incidents, pipeline, project);
    } else {
      pushPipelineTerminalIncident(incidents, pipeline, state, project);
    }
  }

  for (const stage of pipeline.stages) {
    if (stage.status === "failed") {
      if (!isPipelineTerminal(state)) {
        incidents.push({
          incidentId: stageIncidentId(pipeline.id, stage.stageId, stage.branchKey),
          kind: "stage-failed",
          transition: stageFailedTransition(stage),
          project,
          pipelineId: pipeline.id,
          stageId: stage.stageId,
          branchKey: stage.branchKey,
          cause: stageFailedCause(stage),
          sinceMs: stageSinceMs(stage),
        });
      }
      addSuppressedInvocationForFailedStage(stage, entryRunsById, suppressedInvocationIds);
    }
    if (stage.status === "succeeded" && !isPipelineTerminal(state) && isImplementWorkflowStage(pipeline, stage)) {
      pushStageSucceededIncident(incidents, pipeline, stage, project);
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
      pushRunIncident(incidents, run, "run-budget-soft-stopped", resumableStopTransition(run));
      continue;
    }
    if (run.status === "blocked") {
      pushRunIncident(incidents, run, "run-blocked", statusChangeTransition(run, "blocked"));
      continue;
    }
    if (run.status === "paused") {
      pushRunIncident(incidents, run, "run-paused", resumableStopTransition(run));
      continue;
    }
    if (isUnattributedRunTimeout(run, pipelineAttributedRunIds)) {
      pushRunIncident(incidents, run, "run-timeout", statusChangeTransition(run, "run_timeout"));
      continue;
    }
    // Workflow rows roll up to their invocation (`collectInvocationIncidents`); only plain rows settle here.
    if (isPlainRun(run) && isTerminalRunStatus(run.status)) {
      pushRunIncident(incidents, run, "run-ad-hoc-terminal", statusChangeTransition(run, `terminal:${run.status}`));
    }
  }
  return incidents;
}

/** Recompute every current operator-actionable incident from durable rows. */
export function deriveOperatorIncidents(store: StateStore, nowMs: number = Date.now()): OperatorIncident[] {
  const sinceMs = nowMs - ATTENTION_TERMINAL_RECENCY_MS;
  const candidatePipelines = store.listIncidentCandidatePipelines({ sinceMs });
  const candidateRuns = store.listIncidentCandidateRuns({ statuses: RUN_STATUSES, sinceMs });
  const ledger = loadDeliveredLedger(store, collectCandidateIncidentIds(candidatePipelines, candidateRuns));
  const delivered = ledger.keys;

  const activePipelines = candidatePipelines.filter(
    (pipeline) => !onlyDeliveredIncidents(delivered, previewPipelineIncidentKeys(store, pipeline)),
  );

  const needsRunAttribution = candidateRuns.some((run) => !isPlainRun(run) && isTerminalRunStatus(run.status));
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

  const invocations = collectWorkflowInvocations(
    store,
    candidateRuns,
    ledger,
    suppressedInvocationIds,
    pipelineAttributedRunIds,
  );
  // An entry row can sit outside the recency window while a successor settles inside it.
  const invocationDelivered = loadDeliveredIncidentKeys(
    store,
    invocations.map((invocation) => runIncidentId(invocation.entryRun.id)),
  );
  for (const incident of collectInvocationIncidents(invocations)) {
    pushUndeliveredIncident(incidents, invocationDelivered, incident);
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
