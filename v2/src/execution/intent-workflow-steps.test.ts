import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectMatch } from "../../../shared/project-registry.ts";
import { buildIntentWorkflowSteps, buildReviewedIntentWorkflowSteps } from "./intent-workflow-steps.ts";
import type { WorkflowSourceStep } from "./workflow-loader.ts";
import type { ReviewWorkflowStep, WriteWorkflowStep } from "./workflow-runner.ts";

const match: ProjectMatch = { key: "demo", root: "/repo" };
const load = (steps: readonly WorkflowSourceStep[]): WriteWorkflowStep[] =>
  steps.map((step) => ({ ...step, agents: ["claude"], agentModelConfig: {} }));

describe("buildIntentWorkflowSteps", () => {
  test("builds file and inline seeds as one plan step", async () => {
    const root = mkdtempSync(join(tmpdir(), "intent-builder-"));
    const seed = join(root, "Improve API.md");
    writeFileSync(seed, "seed", "utf8");
    const common = { cwd: root, targetDir: "specs" };
    const deps = {
      resolveProjectMatch: () => ({ ...match, root }),
      loadWorkflowSteps: load,
      resolveBaseBranch: () => "trunk",
    };

    const file = await buildIntentWorkflowSteps({ ...common, seed }, deps);
    const inline = await buildIntentWorkflowSteps({ ...common, seedText: "Improve API" }, deps);
    if (!file.ok || !inline.ok) return;
    expect(file.steps).toHaveLength(1);
    expect(inline.steps).toHaveLength(1);
    expect(file.steps[0]).toMatchObject({
      behavior: "write",
      role: "plan",
      promptId: "intent.prompt.split",
      expectedArtifactPath: ".jarvis-intent-stage",
      specPath: "specs/ready-intents",
      worktree: { branchName: "intent/improve-api", baseRef: "trunk" },
    });
    expect(inline.steps[0]).toMatchObject({ role: "plan", promptId: "intent.prompt.split" });
  });

  test("rejects dual seeds, traversal, and reserved slugs before loading steps", async () => {
    let loaded = false;
    const deps = {
      resolveProjectMatch: () => match,
      loadWorkflowSteps: () => {
        loaded = true;
        return [];
      },
    };
    expect((await buildIntentWorkflowSteps({ cwd: "/repo", seedText: "x", seed: "x" }, deps)).ok).toBe(false);
    expect((await buildIntentWorkflowSteps({ cwd: "/repo", seedText: "head" }, deps)).ok).toBe(false);
    expect((await buildIntentWorkflowSteps({ cwd: "/repo", seedText: "x", targetDir: "../spec" }, deps)).ok).toBe(
      false,
    );
    expect((await buildIntentWorkflowSteps({ cwd: "/repo", seed: "/tmp/seed" }, deps)).ok).toBe(false);
    expect(loaded).toBe(false);
  });

  test("uses external ready-intents storage when project git is disabled", async () => {
    const root = mkdtempSync(join(tmpdir(), "intent-builder-"));
    const config = join(root, "config.json");
    writeFileSync(
      config,
      JSON.stringify({ projects: { demo: { root, git: false } }, modes: { plan: { targetDir: "configured" } } }),
    );
    const result = await buildIntentWorkflowSteps(
      { cwd: root, seedText: "one thing", targetDir: "override", configPath: config, jarvisRoot: "/jarvis" },
      { loadWorkflowSteps: load },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps[0]).toMatchObject({
      specPath: "/jarvis/specs/demo/ready-intents",
      publishCompletion: false,
      worktree: { baseRef: "none", git: false, localPath: "/jarvis/intent-work/demo/one-thing" },
    });
  });

  test("only resumes a collision owned by the supplied invocation", async () => {
    const inspect = (recordedInvocationId: string) => ({
      resolveProjectMatch: () => match,
      loadWorkflowSteps: load,
      inspectIdentity: (identity: { invocationId: string }) => ({
        message: "intent branch already exists",
        recordedInvocationId,
        ...(identity.invocationId === recordedInvocationId ? { resumable: true } : {}),
      }),
    });

    const resumed = await buildIntentWorkflowSteps(
      { cwd: "/repo", seedText: "same", invocationId: "inv-1" },
      inspect("inv-1"),
    );
    expect(resumed.ok).toBe(true);

    const rejected = await buildIntentWorkflowSteps(
      { cwd: "/repo", seedText: "same", invocationId: "inv-2" },
      inspect("inv-1"),
    );
    expect(rejected).toMatchObject({ ok: false });
    if (!rejected.ok) expect(rejected.error).toContain("resume the recorded invocation");
  });
});

describe("buildReviewedIntentWorkflowSteps", () => {
  test("rejects non-integer and negative review passes before daemon contact", async () => {
    let loaded = false;
    const deps = {
      resolveProjectMatch: () => match,
      loadWorkflowSteps: () => {
        loaded = true;
        return [];
      },
    };

    const negative = await buildReviewedIntentWorkflowSteps(
      { cwd: "/repo", seedText: "x", reviewPasses: -1 },
      deps,
    );
    expect(negative.ok).toBe(false);
    if (!negative.ok) expect(negative.error).toContain("non-negative integer");

    const fractional = await buildReviewedIntentWorkflowSteps(
      { cwd: "/repo", seedText: "x", reviewPasses: 1.5 },
      deps,
    );
    expect(fractional.ok).toBe(false);
    if (!fractional.ok) expect(fractional.error).toContain("non-negative integer");

    expect(loaded).toBe(false);
  });

  test("delegates to split-only builder when reviewPasses is 0", async () => {
    const root = mkdtempSync(join(tmpdir(), "reviewed-intent-"));
    writeFileSync(join(root, "test.md"), "test", "utf8");

    const result = await buildReviewedIntentWorkflowSteps(
      { cwd: root, seed: "test.md", reviewPasses: 0, targetDir: "specs" },
      {
        resolveProjectMatch: () => ({ ...match, root }),
        loadWorkflowSteps: load,
        resolveBaseBranch: () => "trunk",
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({
      behavior: "write",
      role: "plan",
      promptId: "intent.prompt.split",
    });
  });

  test("defaults reviewPasses to 1 when omitted", async () => {
    const root = mkdtempSync(join(tmpdir(), "reviewed-intent-"));
    writeFileSync(join(root, "test.md"), "test", "utf8");
    const tempDir = mkdtempSync(join(tmpdir(), "machine-profile-"));
    const profileFile = join(tempDir, "local.json");

    const modelConfig = {
      models: {
        claude: {
          plan: { rungs: [{ adapterModel: "claude", priceKey: "claude" }] },
          implement: { rungs: [{ adapterModel: "claude", priceKey: "claude" }] },
          shrink: { rungs: [{ adapterModel: "claude", priceKey: "claude" }] },
          critic: { rungs: [{ adapterModel: "claude", priceKey: "claude" }] },
          actuator: { rungs: [{ adapterModel: "claude", priceKey: "claude" }] },
          adversary: { rungs: [{ adapterModel: "claude", priceKey: "claude" }] },
          advocate: { rungs: [{ adapterModel: "claude", priceKey: "claude" }] },
          adjudicator: { rungs: [{ adapterModel: "claude", priceKey: "claude" }] },
        },
      },
    };
    writeFileSync(profileFile, JSON.stringify(modelConfig));

    const result = await buildReviewedIntentWorkflowSteps(
      { cwd: root, seed: "test.md", targetDir: "specs" },
      {
        resolveProjectMatch: () => ({ ...match, root }),
        loadWorkflowSteps: load,
        resolveBaseBranch: () => "trunk",
        machineProfile: "local",
        machinesDir: tempDir,
      },
    );

    if (!result.ok) {
      throw new Error(`Expected ok=true, got error: ${result.error}`);
    }
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]).toMatchObject({ behavior: "write", role: "plan" });
    const reviewStep = result.steps[1] as ReviewWorkflowStep;
    expect(reviewStep).toMatchObject({
      behavior: "review",
      stepId: "review",
      maxCycles: 1,
    });
  });

  test("produces split plus review step for positive reviewPasses", async () => {
    const root = mkdtempSync(join(tmpdir(), "reviewed-intent-"));
    writeFileSync(join(root, "test.md"), "test", "utf8");
    const tempDir = mkdtempSync(join(tmpdir(), "machine-profile-"));
    const profileFile = join(tempDir, "local.json");

    const modelConfig = {
      models: {
        claude: {
          plan: { rungs: [{ adapterModel: "claude", priceKey: "claude" }] },
          implement: { rungs: [{ adapterModel: "claude", priceKey: "claude" }] },
          shrink: { rungs: [{ adapterModel: "claude", priceKey: "claude" }] },
          critic: { rungs: [{ adapterModel: "claude", priceKey: "claude" }] },
          actuator: { rungs: [{ adapterModel: "claude", priceKey: "claude" }] },
          adversary: { rungs: [{ adapterModel: "claude", priceKey: "claude" }] },
          advocate: { rungs: [{ adapterModel: "claude", priceKey: "claude" }] },
          adjudicator: { rungs: [{ adapterModel: "claude", priceKey: "claude" }] },
        },
      },
    };
    writeFileSync(profileFile, JSON.stringify(modelConfig));

    const result = await buildReviewedIntentWorkflowSteps(
      { cwd: root, seed: "test.md", targetDir: "specs", reviewPasses: 3 },
      {
        resolveProjectMatch: () => ({ ...match, root }),
        loadWorkflowSteps: load,
        resolveBaseBranch: () => "trunk",
        machineProfile: "local",
        machinesDir: tempDir,
      },
    );

    if (!result.ok) {
      throw new Error(`Expected ok=true, got error: ${result.error}`);
    }
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]).toMatchObject({ behavior: "write", role: "plan", stepId: "intent" });

    const reviewStep = result.steps[1] as ReviewWorkflowStep;
    expect(reviewStep).toMatchObject({
      behavior: "review",
      stepId: "review",
      maxCycles: 3,
      verdictPath: join(root, ".jarvis-intent-review-verdict.md"),
      agents: {
        critic: ["claude"],
        actuator: ["claude"],
      },
    });
  });

  test("validates critic and actuator bindings before daemon contact", async () => {
    const root = mkdtempSync(join(tmpdir(), "reviewed-intent-"));
    writeFileSync(join(root, "test.md"), "test", "utf8");
    const tempDir = mkdtempSync(join(tmpdir(), "machine-profile-"));
    const profileFile = join(tempDir, "local.json");

    // Missing critic role
    writeFileSync(
      profileFile,
      JSON.stringify({
        models: {
          claude: {
            plan: { rungs: [{ adapterModel: "claude", priceKey: "claude" }] },
            actuator: { rungs: [{ adapterModel: "claude", priceKey: "claude" }] },
          },
        },
      }),
    );

    const result = await buildReviewedIntentWorkflowSteps(
      { cwd: root, seed: "test.md", targetDir: "specs", reviewPasses: 1 },
      {
        resolveProjectMatch: () => ({ ...match, root }),
        loadWorkflowSteps: load,
        resolveBaseBranch: () => "trunk",
        machineProfile: "local",
        machinesDir: tempDir,
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("critic");
  });
});
