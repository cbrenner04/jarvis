import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectMatch } from "../../../shared/project-registry.ts";
import { buildImplementWorkflowSteps } from "./implement-workflow-steps.ts";
import { loadWorkflowSteps } from "./workflow-loader.ts";

function writeJson(name: string, value: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "implement-workflow-steps-test-"));
  const filePath = join(dir, name);
  writeFileSync(filePath, JSON.stringify(value));
  return filePath;
}

let machinesDir: string | undefined;

function writeProfile(name: string, value: unknown): void {
  machinesDir ??= mkdtempSync(join(tmpdir(), "implement-workflow-steps-machines-"));
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

const VALID_AGENT_MODEL_CONFIG = { claude: FULL_ROLES };

let profileCounter = 0;
function writeValidProfile(): string {
  profileCounter += 1;
  const machineProfile = `implement-workflow-steps-test-profile-${profileCounter}`;
  writeProfile(machineProfile, { models: VALID_AGENT_MODEL_CONFIG });
  return machineProfile;
}

const INPUT = {
  cwd: "/tmp/proj",
  branchName: "implement-run",
  baseRef: "main",
  specPath: "index.md",
  reviewPasses: 0,
};

const INPUT_WITH_ARTIFACT = {
  cwd: "/tmp/proj",
  branchName: "implement-run",
  baseRef: "main",
  specPath: "spec.md",
  artifactPath: "artifact.md",
  reviewPasses: 0,
};

describe("buildImplementWorkflowSteps", () => {
  test("returns a one-step implement preset workflow with resolved project and machine config", () => {
    const machineConfigPath = writeJson("config.json", { agents: ["claude"] });
    const machineProfile = writeValidProfile();
    const match: ProjectMatch = { key: "proj", root: "/tmp/proj" };

    const result = buildImplementWorkflowSteps(INPUT, {
      resolveProjectMatch: () => match,
      loadWorkflowSteps: (steps) => loadWorkflowSteps(steps, { machineConfigPath, machineProfile, machinesDir }),
      resolveActiveLinkedSubspec: () => ({
        ok: true,
        active: {
          index: 0,
          subspec: { checked: false, body: "- [ ] [Sub](./sub.md)", text: "Sub", path: "./sub.md" },
          path: "/tmp/proj/sub.md",
          body: "# Subspec\n",
        },
        isTerminal: true,
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps).toHaveLength(1);
    const step = result.steps[0];
    expect(step?.behavior).toBe("write");
    if (step?.behavior !== "write") return;
    expect(step.role).toBe("implement");
    expect(step.promptId).toBe("patch.prompt.body");
    expect(step.agents).toEqual(["claude"]);
    expect(step.agentModelConfig).toEqual(VALID_AGENT_MODEL_CONFIG);
    expect(step.worktree).toEqual({
      projectRoot: "/tmp/proj",
      projectName: "proj",
      branchName: "implement-run",
      baseRef: "main",
    });
    expect(step.specPath).toBe("index.md");
    expect(step.expectedArtifactPath).toBe("index.md");
  });

  test("uses the supplied projectRoot and projectName for CLI-resolved launches", () => {
    const machineConfigPath = writeJson("config.json", { agents: ["claude"] });
    const machineProfile = writeValidProfile();

    const result = buildImplementWorkflowSteps(
      { ...INPUT, projectRoot: "/tmp/proj", projectName: "proj" },
      {
        loadWorkflowSteps: (steps) => loadWorkflowSteps(steps, { machineConfigPath, machineProfile, machinesDir }),
        resolveActiveLinkedSubspec: () => ({
          ok: true,
          active: {
            index: 0,
            subspec: { checked: false, body: "- [ ] [Sub](./sub.md)", text: "Sub", path: "./sub.md" },
            path: "/tmp/proj/sub.md",
            body: "# Subspec\n",
          },
          isTerminal: true,
        }),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const step = result.steps[0];
    if (step?.behavior !== "write") return;
    expect(step.worktree).toEqual({
      projectRoot: "/tmp/proj",
      projectName: "proj",
      branchName: "implement-run",
      baseRef: "main",
    });
  });

  test("returns an error result naming the unresolved cwd instead of throwing", () => {
    const result = buildImplementWorkflowSteps(INPUT, {
      resolveProjectMatch: () => undefined,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(INPUT.cwd);
  });

  test("returns an error result carrying a machine-config validation failure instead of throwing", () => {
    const match: ProjectMatch = { key: "proj", root: "/tmp/proj" };

    const result = buildImplementWorkflowSteps(INPUT_WITH_ARTIFACT, {
      resolveProjectMatch: () => match,
      loadWorkflowSteps: () => {
        throw new Error("Failed to load agent model config: profile not found");
      },
      resolveActiveLinkedSubspec: () => ({
        ok: true,
        active: {
          index: 0,
          subspec: { checked: false, body: "- [ ] [Sub](./sub.md)", text: "Sub", path: "./sub.md" },
          path: "/tmp/proj/sub.md",
          body: "# Subspec\n",
        },
        isTerminal: true,
      }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Failed to load agent model config");
  });
});
