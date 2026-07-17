import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectMatch } from "../../../shared/project-registry.ts";
import { openStateStore } from "../persistence/state-store.ts";
import type { WithExternalWorktreeResult } from "./external-worktree.ts";
import { buildImplementWorkflowSteps } from "./implement-workflow-steps.ts";
import { loadWorkflowSteps, type WorkflowSourceStep } from "./workflow-loader.ts";
import { executeWorkflow, type WriteWorkflowStep } from "./workflow-runner.ts";

function writeJson(name: string, value: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "implement-workflow-steps-test-"));
  const filePath = join(dir, name);
  writeFileSync(filePath, JSON.stringify(value));
  return filePath;
}

function initGitRepo(root: string): void {
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
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
  test("returns a one-step implement preset workflow with resolved project and machine config", async () => {
    const machineConfigPath = writeJson("config.json", { agents: ["claude"] });
    const machineProfile = writeValidProfile();
    const match: ProjectMatch = { key: "proj", root: "/tmp/proj" };

    const result = await buildImplementWorkflowSteps(INPUT, {
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

  test("reviewPasses 0 returns a one-step implement workflow with no review step", async () => {
    const machineConfigPath = writeJson("config.json", { agents: ["claude"] });
    const machineProfile = writeValidProfile();
    const match: ProjectMatch = { key: "proj", root: "/tmp/proj" };

    const result = await buildImplementWorkflowSteps(INPUT, {
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
    expect(result.steps[0]?.behavior).toBe("write");
  });

  test("stamps resolved reviewBehavior on the implement write step", async () => {
    const machineConfigPath = writeJson("config.json", { agents: ["claude"] });
    const machineProfile = writeValidProfile();
    const match: ProjectMatch = { key: "proj", root: "/tmp/proj" };
    const deps = {
      resolveProjectMatch: () => match,
      loadWorkflowSteps: (steps: readonly WorkflowSourceStep[]) =>
        loadWorkflowSteps(steps, { machineConfigPath, machineProfile, machinesDir }),
      resolveActiveLinkedSubspec: () => ({
        ok: true as const,
        active: {
          index: 0,
          subspec: { checked: false, body: "- [ ] [Sub](./sub.md)", text: "Sub", path: "./sub.md" },
          path: "/tmp/proj/sub.md",
          body: "# Subspec\n",
        },
        isTerminal: true,
      }),
    };

    const defaulted = await buildImplementWorkflowSteps(INPUT, deps);
    expect(defaulted.ok).toBe(true);
    if (!defaulted.ok) return;
    expect(defaulted.steps[0]?.behavior).toBe("write");
    if (defaulted.steps[0]?.behavior !== "write") return;
    expect(defaulted.steps[0].implementReviewBehavior).toBe("debate");

    const light = await buildImplementWorkflowSteps({ ...INPUT, reviewBehavior: "light" }, deps);
    expect(light.ok).toBe(true);
    if (!light.ok) return;
    expect(light.steps[0]?.behavior).toBe("write");
    if (light.steps[0]?.behavior !== "write") return;
    expect(light.steps[0].implementReviewBehavior).toBe("light");
  });

  test("positive reviewPasses appends one review-debate step with maxCycles and verdict path", async () => {
    const machineConfigPath = writeJson("config.json", { agents: ["claude"] });
    const machineProfile = writeValidProfile();
    const match: ProjectMatch = { key: "proj", root: "/tmp/proj" };

    const result = await buildImplementWorkflowSteps(
      { ...INPUT, reviewPasses: 2 },
      {
        resolveProjectMatch: () => match,
        loadWorkflowSteps: (steps: readonly WorkflowSourceStep[]) =>
          loadWorkflowSteps(steps, { machineConfigPath, machineProfile, machinesDir }),
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
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]?.behavior).toBe("write");
    const review = result.steps[1];
    expect(review?.behavior).toBe("review-debate");
    if (review?.behavior !== "review-debate") return;
    expect(review.maxCycles).toBe(2);
    expect(review.verdictPath).toContain("verdict-patch.md");
    expect(review.profile?.domain).toBe("implement");
    expect(review.profileContext).toBeInstanceOf(Function);
    expect(review.prompts?.adversary).toBe("patch.prompt.review.adversary");
  });

  test("positive reviewPasses with light reviewBehavior appends one review step", async () => {
    const machineConfigPath = writeJson("config.json", { agents: ["claude"] });
    const machineProfile = writeValidProfile();
    const match: ProjectMatch = { key: "proj", root: "/tmp/proj" };

    const result = await buildImplementWorkflowSteps(
      { ...INPUT, reviewPasses: 2, reviewBehavior: "light" },
      {
        resolveProjectMatch: () => match,
        loadWorkflowSteps: (steps: readonly WorkflowSourceStep[]) =>
          loadWorkflowSteps(steps, { machineConfigPath, machineProfile, machinesDir }),
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
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]?.behavior).toBe("write");
    const review = result.steps[1];
    expect(review?.behavior).toBe("review");
    if (review?.behavior !== "review") return;
    expect(review.stepId).toBe("implement-review");
    expect(review.maxCycles).toBe(2);
    expect(review.verdictPath).toContain("verdict-patch.md");
    expect(review.profile?.domain).toBe("implement");
    expect(review.profileContext).toBeInstanceOf(Function);
    expect(review.prompt).toBe("patch.prompt.review.critic");
  });

  test("rejects invalid reviewPasses at build time", async () => {
    const result = await buildImplementWorkflowSteps({ ...INPUT, reviewPasses: 1.5 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("non-negative integer");
  });

  test("allows already-complete index routing at build time when review is enabled", async () => {
    const machineConfigPath = writeJson("config.json", { agents: ["claude"] });
    const machineProfile = writeValidProfile();
    const match: ProjectMatch = { key: "proj", root: "/tmp/proj" };

    const result = await buildImplementWorkflowSteps(
      { ...INPUT, reviewPasses: 1 },
      {
        resolveProjectMatch: () => match,
        loadWorkflowSteps: (steps: readonly WorkflowSourceStep[]) =>
          loadWorkflowSteps(steps, { machineConfigPath, machineProfile, machinesDir }),
        resolveActiveLinkedSubspec: () => ({
          ok: false,
          error: "All linked subspecs are complete",
          errorKind: "already_complete",
        }),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps).toHaveLength(2);
  });

  test("uses the supplied projectRoot and projectName for CLI-resolved launches", async () => {
    const machineConfigPath = writeJson("config.json", { agents: ["claude"] });
    const machineProfile = writeValidProfile();

    const result = await buildImplementWorkflowSteps(
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

  test("builds a project-relative write step from the source checkout before its worktree exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "implement-workflow-steps-project-"));
    mkdirSync(join(root, "spec"));
    writeFileSync(join(root, "spec", "index.md"), "- [ ] [Sub](./sub.md)\n", "utf8");
    writeFileSync(join(root, "spec", "sub.md"), "# Sub\n", "utf8");
    const machineConfigPath = writeJson("config.json", { agents: ["claude"] });
    const machineProfile = writeValidProfile();

    const result = await buildImplementWorkflowSteps(
      {
        cwd: root,
        branchName: "new-branch",
        baseRef: "main",
        specPath: "spec/index.md",
        artifactPath: "spec/index.md",
        projectRoot: root,
        projectName: "proj",
        reviewPasses: 0,
      },
      {
        loadWorkflowSteps: (steps) => loadWorkflowSteps(steps, { machineConfigPath, machineProfile, machinesDir }),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const step = result.steps[0];
    expect(step?.behavior).toBe("write");
    if (step?.behavior !== "write") return;
    expect(step.specPath).toBe("spec/index.md");
    expect(step.expectedArtifactPath).toBe("spec/index.md");
    expect(step.worktree.branchName).toBe("new-branch");
  });

  test("resolves an unresolved registered launch and derives branch, artifact, and review defaults", async () => {
    const root = mkdtempSync(join(tmpdir(), "implement-workflow-steps-registered-"));
    mkdirSync(join(root, "specs"));
    writeFileSync(join(root, "specs", "index.md"), "- [ ] [Work](./work.md)\n", "utf8");
    writeFileSync(join(root, "specs", "work.md"), "# Work\n", "utf8");
    initGitRepo(root);
    execFileSync("git", ["add", "specs"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "base"], { cwd: root });
    const machineConfigPath = writeJson("config.json", {
      projects: { registered: { root, implement: { reviewPasses: 2, reviewBehavior: "light" } } },
    });
    const machineProfile = writeValidProfile();

    const result = await buildImplementWorkflowSteps(
      { cwd: root, baseRef: "HEAD", specPath: "specs/index.md", configPath: machineConfigPath },
      {
        loadWorkflowSteps: (steps) => loadWorkflowSteps(steps, { machineConfigPath, machineProfile, machinesDir }),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const write = result.steps[0];
    expect(write?.behavior).toBe("write");
    if (write?.behavior !== "write") return;
    expect(write.worktree.projectRoot).toBe(realpathSync(root));
    expect(write.worktree.branchName).toBe("specs");
    expect(write.expectedArtifactPath).toBe("specs/index.md");
    expect(write.implementReviewBehavior).toBe("light");
    expect(result.steps).toHaveLength(2);
  });

  test("rejects a gitignored cwd-visible spec unavailable from the base ref before routing", async () => {
    const root = mkdtempSync(join(tmpdir(), "implement-workflow-steps-base-ref-"));
    initGitRepo(root);
    writeFileSync(join(root, ".gitignore"), "local-spec/\n", "utf8");
    writeFileSync(join(root, "README.md"), "seed\n", "utf8");
    execFileSync("git", ["add", ".gitignore", "README.md"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "base"], { cwd: root });
    mkdirSync(join(root, "local-spec"));
    writeFileSync(join(root, "local-spec", "index.md"), "- [ ] Work\n", "utf8");

    const result = await buildImplementWorkflowSteps(
      {
        cwd: root,
        baseRef: "HEAD",
        specPath: "local-spec/index.md",
        configPath: writeJson("config.json", { projects: { project: { root } } }),
      },
      {
        loadWorkflowSteps: () => {
          throw new Error("should not load workflow steps");
        },
      },
    );

    expect(result).toEqual({
      ok: false,
      error: "Spec path unavailable in base ref HEAD: local-spec/index.md",
    });
  });

  test("accepts a base-tracked spec launched below the registered project root", async () => {
    const root = mkdtempSync(join(tmpdir(), "implement-workflow-steps-base-ref-"));
    mkdirSync(join(root, "spec", "nested"), { recursive: true });
    writeFileSync(join(root, "spec", "index.md"), "- [ ] [Work](./work.md)\n", "utf8");
    writeFileSync(join(root, "spec", "work.md"), "# Work\n", "utf8");
    initGitRepo(root);
    execFileSync("git", ["add", "spec"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "base"], { cwd: root });
    const machineConfigPath = writeJson("config.json", { agents: ["claude"], projects: { project: { root } } });
    const machineProfile = writeValidProfile();

    const result = await buildImplementWorkflowSteps(
      { cwd: join(root, "spec", "nested"), baseRef: "HEAD", specPath: "../index.md", configPath: machineConfigPath },
      { loadWorkflowSteps: (steps) => loadWorkflowSteps(steps, { machineConfigPath, machineProfile, machinesDir }) },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps[0]?.behavior).toBe("write");
    expect(result.steps[0]).toMatchObject({ specPath: "spec/index.md" });
  });

  test("rejects an unresolved launch whose spec symlink escapes the registered root", async () => {
    const root = mkdtempSync(join(tmpdir(), "implement-workflow-steps-contained-"));
    const outside = mkdtempSync(join(tmpdir(), "implement-workflow-steps-outside-"));
    writeFileSync(join(outside, "index.md"), "- [ ] Work\n", "utf8");
    symlinkSync(join(outside, "index.md"), join(root, "escaped.md"));
    const configPath = writeJson("config.json", { projects: { registered: { root } } });

    const result = await buildImplementWorkflowSteps(
      { cwd: root, baseRef: "main", specPath: "escaped.md", configPath },
      {
        loadWorkflowSteps: () => [],
      },
    );

    expect(result).toEqual({
      ok: false,
      error: `Spec path outside registered project roots: ${realpathSync(join(outside, "index.md"))}`,
    });
  });

  test("executes a first launch in a new worktree with project-relative paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "implement-workflow-steps-project-"));
    const home = mkdtempSync(join(tmpdir(), "implement-workflow-steps-home-"));
    mkdirSync(join(root, "spec"));
    writeFileSync(join(root, "spec", "spec.md"), "- [ ] Work\n", "utf8");
    const machineConfigPath = writeJson("config.json", { agents: ["claude"] });
    const machineProfile = writeValidProfile();
    let reachedWorktree: string | undefined;

    try {
      const result = await buildImplementWorkflowSteps(
        {
          cwd: root,
          branchName: "new-branch",
          baseRef: "main",
          specPath: "spec/spec.md",
          artifactPath: "spec/spec.md",
          projectRoot: root,
          projectName: "proj",
          reviewPasses: 0,
        },
        {
          loadWorkflowSteps: (steps) => loadWorkflowSteps(steps, { machineConfigPath, machineProfile, machinesDir }),
        },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const builtStep = result.steps[0];
      expect(builtStep?.behavior).toBe("write");
      if (builtStep?.behavior !== "write") return;

      const worktreePath = join(home, "worktrees", "proj", "new-branch");
      expect(existsSync(worktreePath)).toBe(false);
      rmSync(root, { recursive: true, force: true });
      const withExternalWorktree: NonNullable<WriteWorkflowStep["withExternalWorktree"]> = async (_args, run) => {
        mkdirSync(join(worktreePath, "spec"), { recursive: true });
        writeFileSync(join(worktreePath, "spec", "spec.md"), "- [ ] Work\n", "utf8");
        const value = await run({ path: worktreePath, reused: false });
        return {
          worktree: { path: worktreePath, reused: false },
          lock: { kind: "acquired" },
          value,
        } satisfies WithExternalWorktreeResult<unknown>;
      };
      const step: WriteWorkflowStep = {
        ...builtStep,
        worktree: { ...builtStep.worktree, jarvisRoot: home },
        promptId: "write.execute",
        suppressShrink: true,
        publishCompletion: false,
        withExternalWorktree,
        createBinding: () => ({
          id: "claude/m1",
          metadata: { agent: "claude", model: "m1" },
          invoke: async ({ cwd }) => {
            reachedWorktree = cwd;
            expect(readFileSync(join(cwd, "spec", "spec.md"), "utf8")).toContain("- [ ] Work");
            writeFileSync(join(cwd, "spec", "spec.md"), "- [x] Work\n", "utf8");
            return { kind: "ok", stdout: "done", stderr: "" } as const;
          },
        }),
      };
      const store = openStateStore(":memory:");
      try {
        const outcome = await executeWorkflow({ steps: [step], stateStore: store });
        expect(outcome.kind).toBe("complete");
      } finally {
        store.close();
      }

      expect(reachedWorktree).toBe(worktreePath);
      expect(readFileSync(join(worktreePath, "spec", "spec.md"), "utf8")).toBe("- [x] Work\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("returns an error result naming the unresolved cwd instead of throwing", async () => {
    const result = await buildImplementWorkflowSteps(INPUT, {
      resolveProjectMatch: () => undefined,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(INPUT.cwd);
  });

  test("returns an error result carrying a machine-config validation failure instead of throwing", async () => {
    const match: ProjectMatch = { key: "proj", root: "/tmp/proj" };

    const result = await buildImplementWorkflowSteps(INPUT_WITH_ARTIFACT, {
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
