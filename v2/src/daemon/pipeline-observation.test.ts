import { expect, test } from "bun:test";
import type { Pipeline, PipelineStageRecord } from "../persistence/state-store.ts";
import { resolvePipelineOwnership } from "./pipeline-observation.ts";

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
    terminalPublicationFailure: null,
    terminalPublicationSucceededAt: null,
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
