import { expect, test } from "bun:test";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import { openStateStore, type StateStore, type WorkflowSnapshot } from "../persistence/state-store.ts";
import { DEFAULT_AGENT_MODEL_CONFIG } from "../testing/workflow-step-fixtures.ts";
import { resolveFailedImplementResumeTarget } from "./pipeline-resume-resumable-implement.ts";
import { composeRunOperatorError } from "./run-operator-error.ts";

const IMPLEMENT_PIPELINE: PipelineDefinition = {
  name: "implement-resume-target",
  stages: [
    { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
    { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
  ],
};

function implementSnapshot(invocationId: string): WorkflowSnapshot {
  return {
    invocationId,
    steps: [
      {
        stepId: "implement",
        role: "implement",
        stepRules: "rules",
        expectedArtifactPath: "spec.md",
        agents: ["claude"],
        agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
        durable: true,
      },
    ],
  };
}

function seedGateRefusedShrink(
  store: StateStore,
  invocationId: string,
  cause: "ceiling_headroom" | "slot_contention",
): { entryRunId: string; shrinkRunId: string } {
  const snapshot = implementSnapshot(invocationId);
  const entryRunId = store.createRun({
    project: "demo",
    specRef: "main",
    worktreePath: "/tmp/implement-resume-entry",
    branch: "feature/implement",
    specPath: "spec/feature/index.md",
    stepId: "implement",
    status: "completed",
    workflowSnapshot: snapshot,
  });
  const shrinkRunId = store.createRun({
    project: "demo",
    specRef: "main",
    worktreePath: "/tmp/implement-resume-entry",
    branch: "feature/implement",
    specPath: "spec/feature/index.md",
    stepId: "implement~shrink",
    workflowSnapshot: snapshot,
  });
  const attemptId = store.recordAttemptStart(shrinkRunId);
  store.commitCompletionBoundary({
    attemptId,
    runStatus: "failed",
    outcomeKind: "gate_invocation_refused",
    terminalCause: "gate_invocation_refused",
    gateRefusalRecoveryState: { cause, gateCommand: "bun run test:v2", slotRedriveCount: 0 },
  });
  return { entryRunId, shrinkRunId };
}

test("resolveFailedImplementResumeTarget returns the shrink sibling for a failed implement stage", () => {
  const store = openStateStore(":memory:");
  const { entryRunId, shrinkRunId } = seedGateRefusedShrink(store, "inv-resume-target", "ceiling_headroom");
  const pipelineId = store.createPipeline({
    definition: IMPLEMENT_PIPELINE,
    context: { cwd: "/tmp", configPath: "/tmp/cfg", seed: "s" },
  });
  store.updateStage({
    pipelineId,
    stageId: "plan",
    patch: { status: "succeeded", workflowInvocationId: "run-plan" },
  });
  store.updateStage({
    pipelineId,
    stageId: "implement",
    patch: { status: "failed", workflowInvocationId: entryRunId },
  });
  const pipeline = store.loadPipeline(pipelineId);
  if (!pipeline) throw new Error("pipeline missing");
  const target = resolveFailedImplementResumeTarget(store, pipeline, undefined, undefined);
  expect(target?.causeRun.id).toBe(shrinkRunId);
  expect(target?.entryRunId).toBe(entryRunId);
  const cause = store.loadRun(shrinkRunId);
  if (!cause) throw new Error("shrink run missing");
  expect(composeRunOperatorError(cause)?.nextAction).toBe("resume");
  store.close();
});

test("resolveFailedImplementResumeTarget honors branch scope on the failed implement row", () => {
  const store = openStateStore(":memory:");
  const { entryRunId, shrinkRunId } = seedGateRefusedShrink(store, "inv-resume-branch-scope", "ceiling_headroom");
  const pipelineId = store.createPipeline({
    definition: IMPLEMENT_PIPELINE,
    context: { cwd: "/tmp", configPath: "/tmp/cfg", seed: "s" },
  });
  store.updateStage({
    pipelineId,
    stageId: "implement",
    patch: { status: "failed", workflowInvocationId: entryRunId },
  });
  const pipeline = store.loadPipeline(pipelineId);
  if (!pipeline) throw new Error("pipeline missing");
  // `record.branchKey === branchScope` flipped to `!==` matches every non-default lane while scoped to "default".
  expect(resolveFailedImplementResumeTarget(store, pipeline, "other", undefined)).toBeUndefined();
  const scoped = resolveFailedImplementResumeTarget(store, pipeline, "default", undefined);
  expect(scoped?.causeRun.id).toBe(shrinkRunId);
  expect(scoped?.entryRunId).toBe(entryRunId);
  store.close();
});

test("resolveFailedImplementResumeTarget ignores non-resumable implement failures", () => {
  const store = openStateStore(":memory:");
  const snapshot = implementSnapshot("inv-stop");
  const entryRunId = store.createRun({
    project: "demo",
    specRef: "main",
    worktreePath: "/tmp/wt",
    branch: "feature/implement",
    specPath: "spec.md",
    stepId: "implement",
    status: "failed",
    workflowSnapshot: snapshot,
  });
  const pipelineId = store.createPipeline({
    definition: IMPLEMENT_PIPELINE,
    context: { cwd: "/tmp", configPath: "/tmp/cfg", seed: "s" },
  });
  store.updateStage({
    pipelineId,
    stageId: "implement",
    patch: { status: "failed", workflowInvocationId: entryRunId },
  });
  const pipeline = store.loadPipeline(pipelineId);
  if (!pipeline) throw new Error("pipeline missing");
  expect(resolveFailedImplementResumeTarget(store, pipeline, undefined, undefined)).toBeUndefined();
  store.close();
});
