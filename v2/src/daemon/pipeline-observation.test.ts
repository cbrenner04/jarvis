import { expect, test } from "bun:test";
import type { AdmittedPipelineSelection, Pipeline, PipelineStageRecord } from "../persistence/state-store.ts";
import { projectPipelineSnapshot, resolvePipelineOwnership } from "./pipeline-observation.ts";

const SAMPLE_ADMITTED_SELECTION: AdmittedPipelineSelection = {
  effective: { risk: "high", effort: "low" },
  sources: { risk: "flag", effort: "seed" },
  registryName: "demo",
};

function activePipeline(ownerIdentity: string): Pipeline & { stages: PipelineStageRecord[] } {
  return {
    id: "pipeline-1",
    name: "ownership",
    createdAt: 0,
    ownerIdentity,
    status: "active",
    definition: {
      name: "ownership",
      stages: [{ stageId: "write", kind: "workflow", workflow: "intent", review: "none" }],
    },
    context: null,
    admittedSelection: null,
    terminalPublicationFailure: null,
    terminalPublicationSucceededAt: null,
    supersedeFailures: null,
    dismissedAt: null,
    stages: [
      {
        id: "stage-1",
        pipelineId: "pipeline-1",
        stageId: "write",
        branchKey: "default",
        position: 0,
        status: "pending",
        workflowInvocationId: null,
        startedAt: null,
        endedAt: null,
        artifact: null,
        failureDetail: null,
        decidedAt: null,
      },
    ],
  };
}

test("resolvePipelineOwnership recognizes only the current daemon identity as owner", () => {
  expect(resolvePipelineOwnership(activePipeline("daemon-a"), "daemon-a")).toEqual({ kind: "owner" });
  expect(resolvePipelineOwnership(activePipeline("daemon-b"), "daemon-a")).toEqual({ kind: "not_owner" });
});

test("projectPipelineSnapshot omits admittedSelection when null and projects it when set", () => {
  const withoutAdmission = projectPipelineSnapshot(activePipeline("daemon-a"));
  expect(withoutAdmission).not.toHaveProperty("admittedSelection");
  expect(JSON.parse(JSON.stringify(withoutAdmission)) as Record<string, unknown>).not.toHaveProperty(
    "admittedSelection",
  );

  const withAdmission = projectPipelineSnapshot({
    ...activePipeline("daemon-a"),
    admittedSelection: SAMPLE_ADMITTED_SELECTION,
  });
  expect(withAdmission.admittedSelection).toEqual(SAMPLE_ADMITTED_SELECTION);
});
