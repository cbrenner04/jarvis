import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWorkflowSteps, type WorkflowSourceStep } from "./workflow-loader.ts";

function writeJson(name: string, value: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "workflow-loader-test-"));
  const filePath = join(dir, name);
  writeFileSync(filePath, JSON.stringify(value));
  return filePath;
}

let machinesDir: string | undefined;

function writeProfile(name: string, value: unknown): void {
  machinesDir ??= mkdtempSync(join(tmpdir(), "workflow-loader-machines-"));
  writeFileSync(join(machinesDir, `${name}.json`), JSON.stringify(value));
}

afterEach(() => {
  if (machinesDir !== undefined) {
    rmSync(machinesDir, { recursive: true, force: true });
    machinesDir = undefined;
  }
});

const RUNG = { rungs: [{ adapterModel: "m1", priceKey: "p1" }] };
const FULL_ROLES = {
  plan: RUNG,
  implement: RUNG,
  shrink: RUNG,
  adversary: RUNG,
  advocate: RUNG,
  adjudicator: RUNG,
  actuator: RUNG,
};

const VALID_AGENT_MODEL_CONFIG = {
  claude: FULL_ROLES,
};

let profileCounter = 0;
function writeValidProfile(): string {
  profileCounter += 1;
  const machineProfile = `workflow-loader-test-profile-${profileCounter}`;
  writeProfile(machineProfile, { models: VALID_AGENT_MODEL_CONFIG });
  return machineProfile;
}

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
    const machineConfigPath = writeJson("config.json", { agents: ["claude"] });
    const machineProfile = writeValidProfile();

    const steps = loadWorkflowSteps([sourceStep()], { machineConfigPath, machineProfile, machinesDir });

    expect(steps).toHaveLength(1);
    expect(steps[0]?.agents).toEqual(["claude"]);
    expect(steps[0]?.agentModelConfig).toEqual(VALID_AGENT_MODEL_CONFIG);
  });

  test("falls back to DEFAULT_WRITE_AGENTS when machine config has no agents key", () => {
    const machineConfigPath = writeJson("config.json", {});
    const machineProfile = writeValidProfile();

    const steps = loadWorkflowSteps([sourceStep()], { machineConfigPath, machineProfile, machinesDir });

    expect(steps[0]?.agents).toEqual(["claude"]);
  });

  test("aggregates multiple missing step/role bindings in one load error", () => {
    const machineConfigPath = writeJson("config.json", { agents: ["claude"] });
    const machineProfile = writeValidProfile();

    try {
      loadWorkflowSteps(
        [sourceStep({ stepId: "step-1", role: "operator" }), sourceStep({ stepId: "step-2", role: "typo-role" })],
        { machineConfigPath, machineProfile, machinesDir },
      );
      throw new Error("expected loadWorkflowSteps to throw");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toContain("step-1");
      expect(message).toContain("step-2");
    }
  });

  test("rejects a step naming role 'operator'", () => {
    const machineConfigPath = writeJson("config.json", { agents: ["claude"] });
    const machineProfile = writeValidProfile();

    expect(() =>
      loadWorkflowSteps([sourceStep({ role: "operator" })], { machineConfigPath, machineProfile, machinesDir }),
    ).toThrow(/step-1.*operator/);
  });

  test("rejects a step naming a role outside the closed Role union", () => {
    const machineConfigPath = writeJson("config.json", { agents: ["claude"] });
    const machineProfile = writeValidProfile();

    expect(() =>
      loadWorkflowSteps([sourceStep({ role: "typo-role" })], { machineConfigPath, machineProfile, machinesDir }),
    ).toThrow(/step-1.*typo-role/);
  });

  test("surfaces agent model config load failure as-is", () => {
    const machineConfigPath = writeJson("config.json", { agents: ["claude"] });

    expect(() =>
      loadWorkflowSteps([sourceStep()], { machineConfigPath, machineProfile: "does-not-exist-profile", machinesDir }),
    ).toThrow(/not found/);
  });
});
