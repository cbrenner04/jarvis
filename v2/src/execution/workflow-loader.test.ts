import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWorkflowSteps, type WorkflowSourceStep } from "./workflow-loader.ts";

function writeJson(name: string, value: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "workflow-loader-test-"));
  const filePath = join(dir, name);
  writeFileSync(filePath, JSON.stringify(value));
  return filePath;
}

const RUNG = { rungs: [{ adapterModel: "m1", priceKey: "p1" }] };
const FULL_ROLES = {
  plan: RUNG,
  implement: RUNG,
  adversary: RUNG,
  advocate: RUNG,
  adjudicator: RUNG,
  actuator: RUNG,
};

const VALID_AGENT_MODEL_CONFIG = {
  claude: FULL_ROLES,
};

function sourceStep(overrides: Partial<WorkflowSourceStep> = {}): WorkflowSourceStep {
  return {
    behavior: "write",
    stepId: "step-1",
    role: "implement",
    worktree: { projectRoot: "/tmp/proj", projectName: "proj", branchName: "branch", baseRef: "main" },
    specPath: "spec.md",
    stepRules: "Return exactly one terminal token.",
    expectedArtifactPath: "proof.txt",
    ...overrides,
  };
}

describe("loadWorkflowSteps", () => {
  test("attaches machine agents and agent model config to every step", () => {
    const machineConfigPath = writeJson("v2.json", { agents: ["claude"] });
    const agentModelConfigPath = writeJson("agent-model-config.json", VALID_AGENT_MODEL_CONFIG);

    const steps = loadWorkflowSteps([sourceStep()], { machineConfigPath, agentModelConfigPath });

    expect(steps).toHaveLength(1);
    expect(steps[0]?.agents).toEqual(["claude"]);
    expect(steps[0]?.agentModelConfig).toEqual(VALID_AGENT_MODEL_CONFIG);
  });

  test("falls back to DEFAULT_WRITE_AGENTS when machine config has no agents key", () => {
    const machineConfigPath = writeJson("v2.json", {});
    const agentModelConfigPath = writeJson("agent-model-config.json", VALID_AGENT_MODEL_CONFIG);

    const steps = loadWorkflowSteps([sourceStep()], { machineConfigPath, agentModelConfigPath });

    expect(steps[0]?.agents).toEqual(["claude"]);
  });

  test("aggregates multiple missing step/role bindings in one load error", () => {
    const machineConfigPath = writeJson("v2.json", { agents: ["claude"] });
    const agentModelConfigPath = writeJson("agent-model-config.json", VALID_AGENT_MODEL_CONFIG);

    try {
      loadWorkflowSteps(
        [sourceStep({ stepId: "step-1", role: "operator" }), sourceStep({ stepId: "step-2", role: "typo-role" })],
        { machineConfigPath, agentModelConfigPath },
      );
      throw new Error("expected loadWorkflowSteps to throw");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toContain("step-1");
      expect(message).toContain("step-2");
    }
  });

  test("rejects a step naming role 'operator'", () => {
    const machineConfigPath = writeJson("v2.json", { agents: ["claude"] });
    const agentModelConfigPath = writeJson("agent-model-config.json", VALID_AGENT_MODEL_CONFIG);

    expect(() =>
      loadWorkflowSteps([sourceStep({ role: "operator" })], { machineConfigPath, agentModelConfigPath }),
    ).toThrow(/step-1.*operator/);
  });

  test("rejects a step naming a role outside the closed Role union", () => {
    const machineConfigPath = writeJson("v2.json", { agents: ["claude"] });
    const agentModelConfigPath = writeJson("agent-model-config.json", VALID_AGENT_MODEL_CONFIG);

    expect(() =>
      loadWorkflowSteps([sourceStep({ role: "typo-role" })], { machineConfigPath, agentModelConfigPath }),
    ).toThrow(/step-1.*typo-role/);
  });

  test("surfaces agent model config load failure as-is", () => {
    const machineConfigPath = writeJson("v2.json", { agents: ["claude"] });

    expect(() =>
      loadWorkflowSteps([sourceStep()], { machineConfigPath, agentModelConfigPath: "/nonexistent/config.json" }),
    ).toThrow(/file not found/);
  });
});
