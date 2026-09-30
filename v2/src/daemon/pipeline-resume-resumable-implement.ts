import type { PersistedRecord } from "../persistence/log-stream.ts";
import type { LinkedStageTarget } from "../persistence/pipeline-stage-settlement.ts";
import type { Pipeline, PipelineStageRecord, Run, StateStore } from "../persistence/state-store.ts";
import { resolveWorkflowRunRollup } from "../persistence/workflow-run-status-rollup.ts";
import { composeRunOperatorError, findTerminalLogRecord } from "./run-operator-error.ts";

export type PipelineResumeRunOutcome = { kind: "ok" } | { kind: "refused"; reason: string; message?: string };

type FailedImplementResumeTarget = {
  entryRunId: string;
  causeRun: Run;
  reopenStage: LinkedStageTarget;
};

function failedImplementStageRecord(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  branchScope: string | undefined,
): PipelineStageRecord | undefined {
  return pipeline.stages.find((record) => {
    const stage = pipeline.definition.stages[record.position];
    return (
      record.status === "failed" &&
      stage?.kind === "workflow" &&
      stage.workflow === "implement" &&
      (branchScope === undefined || record.branchKey === branchScope)
    );
  });
}

/** Failed implement stage whose workflow rollup cause row advertises `nextAction: resume`. */
export function resolveFailedImplementResumeTarget(
  store: StateStore,
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  branchScope: string | undefined,
  loadLogRecords: ((runId: string) => PersistedRecord[]) | undefined,
): FailedImplementResumeTarget | undefined {
  const stage = failedImplementStageRecord(pipeline, branchScope);
  if (stage === undefined || stage.workflowInvocationId === null) return undefined;
  const entryRun = store.loadRun(stage.workflowInvocationId);
  const workflowSnapshot = entryRun?.workflowSnapshot;
  if (entryRun === null || workflowSnapshot === null || workflowSnapshot === undefined) return undefined;
  const siblingRuns = store.findRunsByInvocationId(workflowSnapshot.invocationId);
  const { causeRun } = resolveWorkflowRunRollup({
    entryRun,
    workflowSnapshot,
    siblingRuns,
    isLive: false,
  });
  if (causeRun === undefined) return undefined;
  const logRecords = loadLogRecords?.(causeRun.id);
  const terminalRecord = logRecords === undefined ? undefined : findTerminalLogRecord(logRecords);
  const operatorError = composeRunOperatorError(causeRun, terminalRecord, logRecords);
  if (operatorError?.nextAction !== "resume") return undefined;
  return {
    entryRunId: stage.workflowInvocationId,
    causeRun,
    reopenStage: { pipelineId: pipeline.id, stageId: stage.stageId, branchKey: stage.branchKey },
  };
}
