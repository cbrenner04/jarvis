import { describe, expect, test } from "bun:test";
import type { ApprovalPipelineStage, WorkflowPipelineStage } from "./pipeline-definition.ts";
import { getPipelineDefinition } from "./pipeline-registry.ts";

describe("pipeline-definition", () => {
  test("constructs and reads back a workflow stage and an approval stage", () => {
    const workflowStage: WorkflowPipelineStage = {
      stageId: "intent",
      kind: "workflow",
      workflow: "intent",
      review: "light",
    };
    const approvalStage: ApprovalPipelineStage = { stageId: "approve-intent", kind: "approval" };

    expect(workflowStage.stageId).toBe("intent");
    expect(workflowStage.workflow).toBe("intent");
    expect(workflowStage.review).toBe("light");
    expect(approvalStage.stageId).toBe("approve-intent");
    expect(approvalStage.kind).toBe("approval");
  });
});

describe("getPipelineDefinition", () => {
  test("returns the named definition on a hit", () => {
    const result = getPipelineDefinition("fast");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected hit");
    expect(result.definition.name).toBe("fast");
  });

  test("returns unknown-pipeline error with the requested name on a miss, no definition returned", () => {
    const result = getPipelineDefinition("does-not-exist");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected miss");
    expect(result.error).toEqual({ code: "unknown-pipeline", name: "does-not-exist" });
    expect("definition" in result).toBe(false);
  });

  test("inverting the hit/miss guard fails: a hit is not reported as a miss", () => {
    const result = getPipelineDefinition("fast");

    expect(!result.ok).toBe(false);
  });

  test("inverting the hit/miss guard fails: a miss is not reported as a hit", () => {
    const result = getPipelineDefinition("does-not-exist");

    expect(!result.ok).toBe(true);
  });

  test("full-review stages in order: kind, workflow, posture", () => {
    const result = getPipelineDefinition("full-review");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected hit");
    expect(result.definition.stages).toEqual([
      { stageId: "intent", kind: "workflow", workflow: "intent", review: "light" },
      { stageId: "approve-intent", kind: "approval" },
      { stageId: "plan", kind: "workflow", workflow: "plan", review: "debate" },
      { stageId: "approve-plan", kind: "approval" },
      { stageId: "implement", kind: "workflow", workflow: "implement", review: "debate" },
    ]);
  });

  test("fast stages in order: kind, workflow, posture", () => {
    const result = getPipelineDefinition("fast");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected hit");
    expect(result.definition.stages).toEqual([
      { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
      { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
      { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
    ]);
  });
});
