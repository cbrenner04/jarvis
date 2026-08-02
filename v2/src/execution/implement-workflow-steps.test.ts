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
import { type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { createChainedStageProjectMatch } from "../daemon/pipeline-stage-resolve.ts";
import { openStateStore } from "../persistence/state-store.ts";
import { writeHomeMachineConfig } from "../testing/cli-test-helpers.ts";
import type { WithExternalWorktreeResult } from "./external-worktree.ts";
import { buildImplementWorkflowSteps } from "./implement-workflow-steps.ts";
import { loadWorkflowSteps, type WorkflowSourceStep } from "./workflow-loader.ts";
import { executeWorkflow, type WriteWorkflowStep } from "./workflow-runner.ts";
import { DEFAULT_WRITE_STEP_RULES } from "./write-loop-input.ts";

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

const PROJ_MATCH: ProjectMatch = { key: "proj", root: "/tmp/proj" };

const INPUT_PROJECT_ROOT = {
  cwd: "/tmp/proj",
  branchName: "implement-run",
  baseRef: "main",
  specPath: "index.md",
  projectRoot: "/tmp/proj",
  projectName: "proj",
};

function terminalLinkedSubspec() {
  return {
    ok: true as const,
    active: {
      index: 0,
      subspec: { checked: false, body: "- [ ] [Sub](./sub.md)", text: "Sub", path: "./sub.md" },
      path: "/tmp/proj/sub.md",
      body: "# Subspec\n",
    },
    isTerminal: true,
  };
}

function mockProjectDeps(
  machineConfigPath: string,
  machineProfile: string,
  overrides: Partial<Parameters<typeof buildImplementWorkflowSteps>[1]> = {},
) {
  return {
    resolveProjectMatch: () => PROJ_MATCH,
    loadWorkflowSteps: (steps: readonly WorkflowSourceStep[]) =>
      loadWorkflowSteps(steps, { machineConfigPath, machineProfile, machinesDir }),
    resolveActiveLinkedSubspec: terminalLinkedSubspec,
    ...overrides,
  };
}

function writeRegisteredImplementRepo(
  prefix: string,
  implement?: { reviewPasses?: number; reviewBehavior?: string },
  pipeline?: unknown,
): { root: string; machineConfigPath: string; machineProfile: string } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(root, "specs"));
  writeFileSync(join(root, "specs", "index.md"), "- [ ] [Work](./work.md)\n", "utf8");
  writeFileSync(join(root, "specs", "work.md"), "# Work\n\n## Acceptance criteria\n\n- [ ] Work\n", "utf8");
  initGitRepo(root);
  execFileSync("git", ["add", "specs"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: root });
  const project: Record<string, unknown> = { root };
  if (implement !== undefined) project.implement = implement;
  if (pipeline !== undefined) project.pipeline = pipeline;
  const machineConfigPath = writeJson("config.json", { projects: { registered: project } });
  return { root, machineConfigPath, machineProfile: writeValidProfile() };
}

async function expectAdmitsImplementWithoutPipelineDefinition(prefix: string, pipeline?: unknown): Promise<void> {
  const { root, machineConfigPath, machineProfile } = writeRegisteredImplementRepo(prefix, undefined, pipeline);
  try {
    const result = await buildImplementWorkflowSteps(
      {
        cwd: root,
        branchName: "implement-run",
        baseRef: "HEAD",
        specPath: "specs/work.md",
        artifactPath: "specs/work.md",
        reviewPasses: 0,
        configPath: machineConfigPath,
        projectRegistry: { registered: { root } },
      },
      {
        loadWorkflowSteps: (steps) => loadWorkflowSteps(steps, { machineConfigPath, machineProfile, machinesDir }),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pipelineDefinition).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function buildRegisteredImplement(implement?: { reviewPasses?: number; reviewBehavior?: string }) {
  const { root, machineConfigPath, machineProfile } = writeRegisteredImplementRepo(
    "implement-workflow-steps-registered-",
    implement,
  );
  return buildImplementWorkflowSteps(
    { cwd: root, baseRef: "HEAD", specPath: "specs/index.md", configPath: machineConfigPath },
    { loadWorkflowSteps: (steps) => loadWorkflowSteps(steps, { machineConfigPath, machineProfile, machinesDir }) },
  );
}

describe("buildImplementWorkflowSteps", () => {
  test("returns a one-step implement preset workflow with resolved project and machine config", async () => {
    const machineConfigPath = writeJson("config.json", { agents: ["claude"] });
    const machineProfile = writeValidProfile();

    const result = await buildImplementWorkflowSteps(INPUT, mockProjectDeps(machineConfigPath, machineProfile));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps).toHaveLength(1);
    const step = result.steps[0];
    expect(step?.behavior).toBe("write");
    if (step?.behavior !== "write") return;
    expect(step.role).toBe("implement");
    expect(step.promptId).toBe("patch.prompt.body");
    expect(step.stepRules).toBe(DEFAULT_WRITE_STEP_RULES);
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
    const result = await buildImplementWorkflowSteps(INPUT, mockProjectDeps(machineConfigPath, writeValidProfile()));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.behavior).toBe("write");
  });

  test("omitted reviewPasses defaults to one debate review step", async () => {
    const machineConfigPath = writeJson("config.json", { agents: ["claude"] });
    const machineProfile = writeValidProfile();

    const result = await buildImplementWorkflowSteps(
      INPUT_PROJECT_ROOT,
      mockProjectDeps(machineConfigPath, machineProfile),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]?.behavior).toBe("write");
    const review = result.steps[1];
    expect(review?.behavior).toBe("review-debate");
    if (review?.behavior !== "review-debate") return;
    expect(review.maxCycles).toBe(1);
    expect(review.verdictPath).toContain("verdict-patch.md");
    expect(review.profile?.domain).toBe("implement");
    expect(JSON.parse(JSON.stringify(review.profileContext))).toMatchObject({
      specPath: "index.md",
      passNumber: 1,
      totalPasses: 1,
    });
    expect(review.prompts?.adversary).toBe("patch.prompt.review.adversary");
  });

  test("stamps resolved reviewBehavior on the implement write step", async () => {
    const machineConfigPath = writeJson("config.json", { agents: ["claude"] });
    const machineProfile = writeValidProfile();
    const deps = mockProjectDeps(machineConfigPath, machineProfile);

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

    const result = await buildImplementWorkflowSteps(
      { ...INPUT, reviewPasses: 2 },
      mockProjectDeps(machineConfigPath, machineProfile),
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
    // Must survive the daemon IPC JSON round-trip: a function context is silently dropped.
    expect(JSON.parse(JSON.stringify(review.profileContext))).toMatchObject({
      specPath: INPUT.specPath,
      passNumber: 1,
      totalPasses: 2,
    });
    expect(review.prompts?.adversary).toBe("patch.prompt.review.adversary");
  });

  test("positive reviewPasses with light reviewBehavior appends one review step", async () => {
    const machineConfigPath = writeJson("config.json", { agents: ["claude"] });
    const machineProfile = writeValidProfile();

    const result = await buildImplementWorkflowSteps(
      { ...INPUT, reviewPasses: 2, reviewBehavior: "light" },
      mockProjectDeps(machineConfigPath, machineProfile),
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
    expect(JSON.parse(JSON.stringify(review.profileContext))).toMatchObject({
      specPath: INPUT.specPath,
      passNumber: 1,
      totalPasses: 2,
    });
    expect(review.prompt).toBe("patch.prompt.review.critic");
  });

  test("rejects invalid reviewPasses at build time", async () => {
    const result = await buildImplementWorkflowSteps({ ...INPUT, reviewPasses: 1.5 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("non-negative integer");
  });

  test("rejects an already-complete linked tree at build time", async () => {
    const machineConfigPath = writeJson("config.json", { agents: ["claude"] });
    const machineProfile = writeValidProfile();

    const result = await buildImplementWorkflowSteps(
      { ...INPUT, reviewPasses: 1 },
      mockProjectDeps(machineConfigPath, machineProfile, {
        resolveActiveLinkedSubspec: () => ({
          ok: false,
          error: "All linked subspecs are complete",
          errorKind: "already_complete",
        }),
        readSpecFile: (path) =>
          path.endsWith("index.md")
            ? "- [ ] [One](./one.md)\n- [x] [Two](./two.md)\n"
            : "## Acceptance criteria\n\n- [x] Done\n- [ ] Confirmed visually (Manual)\n",
      }),
    );

    expect(result).toEqual({
      ok: false,
      error: "implement.already_complete: requested spec has no unchecked non-human-only acceptance criteria",
    });
  });

  test("uses linked subspec criteria instead of contradictory index checkboxes", async () => {
    const machineConfigPath = writeJson("config.json", { agents: ["claude"] });
    const machineProfile = writeValidProfile();
    const result = await buildImplementWorkflowSteps(
      INPUT,
      mockProjectDeps(machineConfigPath, machineProfile, {
        resolveActiveLinkedSubspec: () => ({
          ok: false,
          error: "All linked subspecs are complete",
          errorKind: "already_complete",
        }),
        readSpecFile: (path) =>
          path.endsWith("index.md")
            ? "- [x] [One](./one.md)\n- [ ] [Two](./two.md)\n"
            : path.endsWith("one.md")
              ? "## Acceptance criteria\n\n- [ ] Implement\n"
              : "## Acceptance criteria\n\n- [x] Done\n",
      }),
    );
    expect(result.ok).toBe(true);
  });

  test("rejects a complete single-file spec and launches an incomplete one", async () => {
    const complete = await buildImplementWorkflowSteps(INPUT_WITH_ARTIFACT, {
      resolveProjectMatch: () => ({ key: "proj", root: "/tmp/proj" }),
      readSpecFile: () => "## Acceptance criteria\n\n- [x] Done\n- [ ] Visual check (Manual)\n",
    });
    expect(complete.ok).toBe(false);
    if (!complete.ok) expect(complete.error).toContain("already_complete");

    const incomplete = await buildImplementWorkflowSteps(INPUT_WITH_ARTIFACT, {
      resolveProjectMatch: () => ({ key: "proj", root: "/tmp/proj" }),
      readSpecFile: () => "## Acceptance criteria\n\n- [ ] Implement\n",
      loadWorkflowSteps: (steps) => steps as WriteWorkflowStep[],
    });
    expect(incomplete.ok).toBe(true);
  });

  test("uses the supplied projectRoot and projectName for CLI-resolved launches", async () => {
    const machineConfigPath = writeJson("config.json", { agents: ["claude"] });
    const machineProfile = writeValidProfile();

    const result = await buildImplementWorkflowSteps(
      { ...INPUT, projectRoot: "/tmp/proj", projectName: "proj" },
      {
        loadWorkflowSteps: (steps) => loadWorkflowSteps(steps, { machineConfigPath, machineProfile, machinesDir }),
        resolveActiveLinkedSubspec: terminalLinkedSubspec,
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

  test("derives branchName from the spec directory only when projectRoot is supplied", async () => {
    const machineConfigPath = writeJson("config.json", { agents: ["claude"] });
    const machineProfile = writeValidProfile();
    const deps = {
      loadWorkflowSteps: (steps: Parameters<typeof loadWorkflowSteps>[0]) =>
        loadWorkflowSteps(steps, { machineConfigPath, machineProfile, machinesDir }),
      resolveActiveLinkedSubspec: terminalLinkedSubspec,
    };

    // projectRoot present and branchName omitted: derived from the spec's directory.
    const derived = await buildImplementWorkflowSteps(
      {
        ...INPUT_PROJECT_ROOT,
        branchName: undefined,
        specPath: "spec/20260101T000000Z-example/index.md",
      } as unknown as typeof INPUT_PROJECT_ROOT,
      deps,
    );
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    const derivedStep = derived.steps[0];
    if (derivedStep?.behavior !== "write") return;
    expect(derivedStep.worktree.branchName).toBe("20260101T000000Z-example");

    // resolveProjectMatch path (no projectRoot): branchName is passed through, never derived.
    const passedThrough = await buildImplementWorkflowSteps(
      { ...INPUT, branchName: "explicit-branch" },
      { ...deps, resolveProjectMatch: () => PROJ_MATCH },
    );
    expect(passedThrough.ok).toBe(true);
    if (!passedThrough.ok) return;
    const passedStep = passedThrough.steps[0];
    if (passedStep?.behavior !== "write") return;
    expect(passedStep.worktree.branchName).toBe("explicit-branch");
  });

  test("builds a project-relative write step from the source checkout before its worktree exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "implement-workflow-steps-project-"));
    mkdirSync(join(root, "spec"));
    writeFileSync(join(root, "spec", "index.md"), "- [ ] [Sub](./sub.md)\n", "utf8");
    writeFileSync(join(root, "spec", "sub.md"), "# Sub\n\n## Acceptance criteria\n\n- [ ] Work\n", "utf8");
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
    const { root, machineConfigPath, machineProfile } = writeRegisteredImplementRepo(
      "implement-workflow-steps-registered-",
      { reviewPasses: 2, reviewBehavior: "light" },
    );

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

  test("registered project reviewPasses absent defaults to debate; explicit 0 omits review", async () => {
    const absent = await buildRegisteredImplement();
    expect(absent.ok).toBe(true);
    if (!absent.ok) return;
    expect(absent.steps).toHaveLength(2);
    expect(absent.steps[1]?.behavior).toBe("review-debate");

    const optOut = await buildRegisteredImplement({ reviewPasses: 0 });
    expect(optOut.ok).toBe(true);
    if (!optOut.ok) return;
    expect(optOut.steps).toHaveLength(1);
    expect(optOut.steps[0]?.behavior).toBe("write");
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
    writeFileSync(join(root, "spec", "work.md"), "# Work\n\n## Acceptance criteria\n\n- [ ] Work\n", "utf8");
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
    writeFileSync(join(root, "spec", "spec.md"), "## Acceptance criteria\n\n- [ ] Work\n", "utf8");
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

  test("rejects implement when the project config record is missing", async () => {
    const { root, machineProfile } = writeRegisteredImplementRepo("implement-workflow-steps-missing-project-record-");
    const configWithoutRecord = writeJson("config.json", { projects: { registered: "not-an-object" } });
    try {
      const result = await buildImplementWorkflowSteps(
        {
          cwd: root,
          branchName: "implement-run",
          baseRef: "HEAD",
          specPath: "specs/work.md",
          artifactPath: "specs/work.md",
          reviewPasses: 0,
          configPath: configWithoutRecord,
          projectRegistry: { registered: { root } },
        },
        {
          loadWorkflowSteps: (steps) =>
            loadWorkflowSteps(steps, { machineConfigPath: configWithoutRecord, machineProfile, machinesDir }),
        },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe("projects.registered must be an object");
      expect(result.error).not.toContain("invalid-project-pipeline-config");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test.each([
    ["missing terminalAction", { name: "fast" }],
    ["invalid reviewOverrides", { name: "fast", terminalAction: "leave-draft", reviewOverrides: [] }],
  ])("admits implement when projects.<key>.pipeline is stale (%s)", async (_label, pipeline) => {
    // Inversion target: resolveProjectPipeline call in admitProjectPipeline — re-enabling resolution on stale pipeline configs turns this test RED.
    await expectAdmitsImplementWithoutPipelineDefinition("implement-workflow-steps-stale-pipeline-", pipeline);
  });

  test("admits implement when the registered project omits pipeline", async () => {
    await expectAdmitsImplementWithoutPipelineDefinition("implement-workflow-steps-no-pipeline-");
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
    const result = await buildImplementWorkflowSteps(
      INPUT_WITH_ARTIFACT,
      mockProjectDeps(writeJson("config.json", { agents: ["claude"] }), writeValidProfile(), {
        loadWorkflowSteps: () => {
          throw new Error("Failed to load agent model config: profile not found");
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Failed to load agent model config");
  });

  test("chained pipeline preflight uses prior worktree as git root and prior branch as baseRef", async () => {
    const root = mkdtempSync(join(tmpdir(), "implement-chained-preflight-"));
    initGitRepo(root);
    writeFileSync(join(root, "README.md"), "base\n", "utf8");
    execFileSync("git", ["add", "README.md"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "base"], { cwd: root });

    const planBranch = "plan/feature";
    const planSpecRel = "spec/feature/index.md";
    const planWorktree = join(root, ".jarvis-worktrees", planBranch);
    mkdirSync(planWorktree, { recursive: true });
    execFileSync("git", ["branch", planBranch], { cwd: root });
    execFileSync("git", ["worktree", "add", planWorktree, planBranch], { cwd: root });
    mkdirSync(join(planWorktree, "spec", "feature"), { recursive: true });
    writeFileSync(join(planWorktree, planSpecRel), "# Feature\n\n- [ ] [Work](./00-work.md)\n", "utf8");
    writeFileSync(
      join(planWorktree, "spec/feature/00-work.md"),
      "# Work\n\n## Acceptance criteria\n\n- [ ] Work\n",
      "utf8",
    );
    execFileSync("git", ["add", "-A"], { cwd: planWorktree });
    execFileSync("git", ["commit", "-qm", "plan"], { cwd: planWorktree });

    const catFileCalls: Array<{ cwd: string; ref: string }> = [];
    const runner: AsyncSubprocessRunner = {
      runAsync: async (command, args, cwd, options) => {
        if (command === "git" && args[0] === "cat-file" && args[1] === "-e") {
          catFileCalls.push({ cwd: cwd ?? "", ref: args[2] ?? "" });
        }
        return realAsyncSubprocessRunner.runAsync(command, args, cwd, options);
      },
    };

    const machineConfigPath = writeHomeMachineConfig({ projects: { registered: { root } } });
    const machineProfile = "home";
    const context = { cwd: root, seed: "unused", projectRegistry: { registered: { root } } };
    const result = await buildImplementWorkflowSteps(
      {
        cwd: planWorktree,
        baseRef: planBranch,
        specPath: planSpecRel,
        projectRoot: root,
        projectName: "registered",
        preflightGitRoot: planWorktree,
        reviewPasses: 0,
        configPath: machineConfigPath,
        projectRegistry: { registered: { root } },
      },
      {
        asyncSubprocessRunner: runner,
        resolveProjectMatch: createChainedStageProjectMatch(context),
        loadWorkflowSteps: (steps) => loadWorkflowSteps(steps, { machineConfigPath, machineProfile }),
        resolveActiveLinkedSubspec: () => ({ ok: false, error: "empty", errorKind: "empty_index" }),
      },
    );

    expect(result.ok).toBe(true);
    expect(catFileCalls).toContainEqual({ cwd: planWorktree, ref: `${planBranch}:${planSpecRel}` });
    expect(catFileCalls.some((call) => call.cwd === root && call.ref.startsWith("main:"))).toBe(false);

    const wrongBaseRef = await buildImplementWorkflowSteps(
      {
        cwd: planWorktree,
        baseRef: "main",
        specPath: planSpecRel,
        projectRoot: root,
        projectName: "registered",
        preflightGitRoot: planWorktree,
        reviewPasses: 0,
        configPath: machineConfigPath,
        projectRegistry: { registered: { root } },
      },
      {
        asyncSubprocessRunner: runner,
        resolveProjectMatch: createChainedStageProjectMatch(context),
        loadWorkflowSteps: (steps) => loadWorkflowSteps(steps, { machineConfigPath, machineProfile }),
        resolveActiveLinkedSubspec: () => ({ ok: false, error: "empty", errorKind: "empty_index" }),
      },
    );
    expect(wrongBaseRef.ok).toBe(false);
    if (wrongBaseRef.ok) return;
    expect(wrongBaseRef.error).toContain("Spec path unavailable in base ref main");
  });
});
