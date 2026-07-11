import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadWorkflowSteps,
  type ReviewDebateWorkflowSourceStep,
  type ReviewWorkflowSourceStep,
  type WriteWorkflowSourceStep,
} from "./workflow-loader.ts";

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
  critic: RUNG,
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

function sourceStep(overrides: Partial<WriteWorkflowSourceStep> = {}): WriteWorkflowSourceStep {
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

function reviewSourceStep(overrides: Partial<ReviewWorkflowSourceStep> = {}): ReviewWorkflowSourceStep {
  return {
    behavior: "review",
    stepId: "review-1",
    project: "proj",
    branch: "branch",
    cwd: "/tmp/proj",
    prompt: "Find flaws.",
    verdictPath: "/tmp/verdict.md",
    maxCycles: 1,
    ...overrides,
  };
}

function debateSourceStep(overrides: Partial<ReviewDebateWorkflowSourceStep> = {}): ReviewDebateWorkflowSourceStep {
  return {
    behavior: "review-debate",
    stepId: "debate-1",
    project: "proj",
    branch: "branch",
    cwd: "/tmp/proj",
    prompts: {
      adversary: "Find flaws.",
      advocate: "Defend the change.",
      adjudicator: "Reach a verdict.",
    },
    verdictPath: "/tmp/verdict.md",
    maxCycles: 1,
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

  test("attaches every machine agent and model config to both review roles", () => {
    const machineConfigPath = writeJson("config.json", { agents: ["claude", "codex"] });
    const machineProfile = writeValidProfile();

    const agentModelConfig = { ...VALID_AGENT_MODEL_CONFIG, codex: FULL_ROLES };
    const steps = loadWorkflowSteps([reviewSourceStep()], {
      machineConfigPath,
      machineProfile,
      machinesDir,
      loadAgentModelConfig: () => agentModelConfig,
    });

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      behavior: "review",
      agents: {
        critic: ["claude", "codex"],
        actuator: ["claude", "codex"],
      },
      agentModelConfig,
    });
    expect("role" in (steps[0] ?? {})).toBe(false);
  });

  test("uses the supplied config path to select the machine profile", () => {
    const machineConfigPath = writeJson("config.json", { agents: ["claude"], machineProfile: "configured" });
    writeProfile("configured", { models: VALID_AGENT_MODEL_CONFIG });

    const steps = loadWorkflowSteps([reviewSourceStep()], { machineConfigPath, machinesDir });

    expect(steps[0]?.agentModelConfig).toEqual(VALID_AGENT_MODEL_CONFIG);
  });

  test("attaches every machine agent and model config to all debate roles", () => {
    const machineConfigPath = writeJson("config.json", { agents: ["claude", "codex"] });
    const machineProfile = writeValidProfile();
    const agentModelConfig = { ...VALID_AGENT_MODEL_CONFIG, codex: FULL_ROLES };

    const steps = loadWorkflowSteps([debateSourceStep()], {
      machineConfigPath,
      machineProfile,
      machinesDir,
      loadAgentModelConfig: () => agentModelConfig,
    });

    expect(steps[0]).toMatchObject({
      behavior: "review-debate",
      agents: {
        adversary: ["claude", "codex"],
        advocate: ["claude", "codex"],
        adjudicator: ["claude", "codex"],
        actuator: ["claude", "codex"],
      },
      agentModelConfig,
    });
  });

  test("aggregates missing bindings across review roles and agents", () => {
    const machineConfigPath = writeJson("config.json", { agents: ["claude", "codex"] });

    expect(() =>
      loadWorkflowSteps([reviewSourceStep()], {
        machineConfigPath,
        machineProfile: "test-profile",
        loadAgentModelConfig: () => ({ claude: {}, codex: {} }),
      }),
    ).toThrow(
      /\(review-1, critic, claude\).*\(review-1, critic, codex\).*\(review-1, actuator, claude\).*\(review-1, actuator, codex\)/,
    );
  });

  test("aggregates missing bindings across all debate roles and agents", () => {
    const machineConfigPath = writeJson("config.json", { agents: ["claude", "codex"] });

    expect(() =>
      loadWorkflowSteps([debateSourceStep()], {
        machineConfigPath,
        machineProfile: "test-profile",
        loadAgentModelConfig: () => ({ claude: {}, codex: {} }),
      }),
    ).toThrow(
      /\(debate-1, adversary, claude\).*\(debate-1, adversary, codex\).*\(debate-1, advocate, claude\).*\(debate-1, advocate, codex\).*\(debate-1, adjudicator, claude\).*\(debate-1, adjudicator, codex\).*\(debate-1, actuator, claude\).*\(debate-1, actuator, codex\)/,
    );
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
