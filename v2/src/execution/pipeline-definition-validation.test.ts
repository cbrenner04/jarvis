import { describe, expect, test } from "bun:test";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import type { PipelineDefinition, PipelineValidationResult } from "./pipeline-definition.ts";
import { validatePipelineDefinition } from "./pipeline-definition.ts";
import { PIPELINE_REGISTRY } from "./pipeline-registry.ts";

const ALL_REVIEW_ROLES_CONFIG: AgentModelConfig = {
  claude: {
    critic: { rungs: [{ adapterModel: "critic", priceKey: "p-critic" }] },
    actuator: { rungs: [{ adapterModel: "actuator", priceKey: "p-actuator" }] },
    adversary: { rungs: [{ adapterModel: "adversary", priceKey: "p-adversary" }] },
    advocate: { rungs: [{ adapterModel: "advocate", priceKey: "p-advocate" }] },
    adjudicator: { rungs: [{ adapterModel: "adjudicator", priceKey: "p-adjudicator" }] },
  },
};

const DEBATE_MISSING_ADJUDICATOR_CONFIG: AgentModelConfig = {
  claude: {
    adversary: { rungs: [{ adapterModel: "adversary", priceKey: "p-adversary" }] },
    advocate: { rungs: [{ adapterModel: "advocate", priceKey: "p-advocate" }] },
    actuator: { rungs: [{ adapterModel: "actuator", priceKey: "p-actuator" }] },
  },
};

const LIGHT_INTENT_DEFINITION: PipelineDefinition = {
  name: "light",
  stages: [{ stageId: "intent", kind: "workflow", workflow: "intent", review: "light" }],
};

function workflowStage(stageId: string, workflow: string, review: string): PipelineDefinition["stages"][number] {
  return { stageId, kind: "workflow", workflow, review };
}

function expectValidationFailure(
  result: PipelineValidationResult,
): asserts result is Extract<PipelineValidationResult, { ok: false }> {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected failure");
}

describe("validatePipelineDefinition", () => {
  test("unknown-workflow names stage ID and workflow field in the message", () => {
    const result = validatePipelineDefinition(
      { name: "bad", stages: [workflowStage("plan-step", "intent-reviewed", "none")] },
      { agentModelConfig: ALL_REVIEW_ROLES_CONFIG },
    );
    expectValidationFailure(result);
    expect(result.errors[0]).toMatchObject({
      code: "unknown-workflow",
      stageId: "plan-step",
      field: "workflow",
    });
    expect(result.errors[0]?.message).toContain("plan-step");
    expect(result.errors[0]?.message).toContain("workflow");
  });

  test("invalid-review-posture names stage ID and review field in the message", () => {
    const result = validatePipelineDefinition(
      { name: "bad", stages: [workflowStage("intent-step", "intent", "heavy")] },
      { agentModelConfig: ALL_REVIEW_ROLES_CONFIG },
    );
    expectValidationFailure(result);
    expect(result.errors[0]).toMatchObject({
      code: "invalid-review-posture",
      stageId: "intent-step",
      field: "review",
    });
    expect(result.errors[0]?.message).toContain("intent-step");
    expect(result.errors[0]?.message).toContain("review");
  });

  test("intent under debate and light on the same stage both validate clean", () => {
    expect(
      validatePipelineDefinition(
        { name: "ok", stages: [workflowStage("intent-step", "intent", "debate")] },
        { agentModelConfig: ALL_REVIEW_ROLES_CONFIG },
      ).ok,
    ).toBe(true);

    expect(
      validatePipelineDefinition(
        { name: "ok", stages: [workflowStage("intent-step", "intent", "light")] },
        { agentModelConfig: ALL_REVIEW_ROLES_CONFIG },
      ).ok,
    ).toBe(true);
  });

  test("implement under none is unrealizable; light on the same stage validates clean", () => {
    const noneResult = validatePipelineDefinition(
      { name: "bad", stages: [workflowStage("implement-step", "implement", "none")] },
      { agentModelConfig: ALL_REVIEW_ROLES_CONFIG },
    );
    expectValidationFailure(noneResult);
    expect(noneResult.errors[0]).toMatchObject({
      code: "unrealizable-review-posture",
      stageId: "implement-step",
      field: "review",
    });
    const noneMessage = noneResult.errors[0]?.message ?? "";
    expect(noneMessage).toContain("implement-step");
    expect(noneMessage).toContain("review");
    expect(noneMessage).toContain("implement");
    expect(noneMessage).toContain("none");

    expect(
      validatePipelineDefinition(
        { name: "ok", stages: [workflowStage("implement-step", "implement", "light")] },
        { agentModelConfig: ALL_REVIEW_ROLES_CONFIG },
      ).ok,
    ).toBe(true);
  });

  test("debate stage missing adjudicator binding fails; none posture skips role-binding check", () => {
    const debateResult = validatePipelineDefinition(
      { name: "debate", stages: [workflowStage("plan-step", "plan", "debate")] },
      { agentModelConfig: DEBATE_MISSING_ADJUDICATOR_CONFIG },
    );
    expectValidationFailure(debateResult);
    const bindingError = debateResult.errors.find((e) => e.code === "missing-role-binding");
    expect(bindingError).toMatchObject({
      code: "missing-role-binding",
      stageId: "plan-step",
      field: "review",
    });
    expect(bindingError?.message).toContain("plan-step");
    expect(bindingError?.message).toContain("review");
    expect(bindingError?.message).toContain("adjudicator");

    expect(
      validatePipelineDefinition(
        { name: "none", stages: [workflowStage("plan-step", "plan", "none")] },
        { agentModelConfig: DEBATE_MISSING_ADJUDICATOR_CONFIG },
      ).ok,
    ).toBe(true);
  });

  test("duplicate stageId yields pipeline-scoped error naming the duplicated ID; unique IDs pass", () => {
    const dupResult = validatePipelineDefinition(
      {
        name: "dup",
        stages: [workflowStage("shared", "intent", "none"), { stageId: "shared", kind: "approval" }],
      },
      { agentModelConfig: ALL_REVIEW_ROLES_CONFIG },
    );
    expectValidationFailure(dupResult);
    expect(dupResult.errors[0]).toMatchObject({
      code: "duplicate-stage-id",
      stageId: null,
      field: "stages",
    });
    expect(dupResult.errors[0]?.message).toContain("shared");

    expect(
      validatePipelineDefinition(
        {
          name: "unique",
          stages: [workflowStage("intent", "intent", "none"), { stageId: "approve", kind: "approval" }],
        },
        { agentModelConfig: ALL_REVIEW_ROLES_CONFIG },
      ).ok,
    ).toBe(true);
  });

  test("empty pipeline yields empty-pipeline; non-empty passes this check", () => {
    const emptyResult = validatePipelineDefinition(
      { name: "empty", stages: [] },
      { agentModelConfig: ALL_REVIEW_ROLES_CONFIG },
    );
    expectValidationFailure(emptyResult);
    expect(emptyResult.errors[0]).toMatchObject({
      code: "empty-pipeline",
      stageId: null,
      field: "stages",
    });

    expect(
      validatePipelineDefinition(
        { name: "one", stages: [workflowStage("only", "plan", "none")] },
        { agentModelConfig: ALL_REVIEW_ROLES_CONFIG },
      ).ok,
    ).toBe(true);
  });

  test("every registered definition validates clean when all review roles are bound", () => {
    for (const definition of Object.values(PIPELINE_REGISTRY)) {
      expect(validatePipelineDefinition(definition, { agentModelConfig: ALL_REVIEW_ROLES_CONFIG }).ok).toBe(true);
    }
  });

  test.each([
    ["empty AgentModelConfig", {} satisfies AgentModelConfig],
    ["undefined agent entry", { claude: undefined } satisfies AgentModelConfig],
  ] as const)("config with %s yields missing-role-binding without throwing", (_label, agentModelConfig) => {
    const result = validatePipelineDefinition(LIGHT_INTENT_DEFINITION, { agentModelConfig });
    expectValidationFailure(result);
    expect(result.errors.some((e) => e.code === "missing-role-binding")).toBe(true);
  });

  test("multiple bad workflow stages yield one error per stage", () => {
    const result = validatePipelineDefinition(
      {
        name: "multi",
        stages: [workflowStage("first", "bogus-a", "none"), workflowStage("second", "bogus-b", "none")],
      },
      { agentModelConfig: ALL_REVIEW_ROLES_CONFIG },
    );
    expectValidationFailure(result);
    const unknownErrors = result.errors.filter((e) => e.code === "unknown-workflow");
    expect(unknownErrors).toHaveLength(2);
    expect(unknownErrors.map((e) => e.stageId).sort()).toEqual(["first", "second"]);
  });
});
