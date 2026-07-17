import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectMatch } from "../../../shared/project-registry.ts";
import { buildIntentWorkflowSteps, buildReviewedIntentWorkflowSteps } from "./publication-workflow-steps.ts";
import type { LoadedWorkflowStep, WorkflowSourceStep } from "./workflow-loader.ts";
import type { ReviewWorkflowStep } from "./workflow-runner.ts";

const match: ProjectMatch = { key: "demo", root: "/repo" };
const load = (steps: readonly WorkflowSourceStep[]): LoadedWorkflowStep[] =>
  steps.map((step) =>
    step.behavior === "write"
      ? { ...step, agents: ["claude"], agentModelConfig: {} }
      : step.behavior === "review"
        ? { ...step, agents: { critic: ["claude"], actuator: ["claude"] }, agentModelConfig: {} }
        : {
            ...step,
            agents: {
              adversary: ["claude"],
              advocate: ["claude"],
              adjudicator: ["claude"],
              actuator: ["claude"],
            },
            agentModelConfig: {},
          },
  );

describe("buildIntentWorkflowSteps", () => {
  test("omits review by default and for zero passes", async () => {
    const noReview = await buildIntentWorkflowSteps(
      { cwd: "/repo", seedText: "x" },
      { resolveProjectMatch: () => match, loadWorkflowSteps: load },
    );
    const zero = await buildIntentWorkflowSteps(
      { cwd: "/repo", seedText: "x", reviewPasses: 0 },
      { resolveProjectMatch: () => match, loadWorkflowSteps: load },
    );
    expect(noReview.ok && noReview.steps).toHaveLength(1);
    expect(zero.ok && zero.steps).toHaveLength(1);
  });

  test("selects light or debate review for positive passes", async () => {
    const deps = { resolveProjectMatch: () => match, loadWorkflowSteps: load };
    const light = await buildIntentWorkflowSteps(
      { cwd: "/repo", seedText: "x", reviewPasses: 1, reviewBehavior: "light" },
      deps,
    );
    const debate = await buildIntentWorkflowSteps({ cwd: "/repo", seedText: "x", reviewPasses: 2 }, deps);
    expect(light.ok && light.steps[1]?.behavior).toBe("review");
    expect(debate.ok && debate.steps[1]?.behavior).toBe("review-debate");
  });

  test("rejects invalid review options", async () => {
    const deps = { resolveProjectMatch: () => match, loadWorkflowSteps: load };
    expect((await buildIntentWorkflowSteps({ cwd: "/repo", seedText: "x", reviewPasses: -1 }, deps)).ok).toBe(false);
    expect(
      (
        await buildIntentWorkflowSteps(
          { cwd: "/repo", seedText: "x", reviewPasses: 1, reviewBehavior: "heavy" as "light" },
          deps,
        )
      ).ok,
    ).toBe(false);
  });
  test("builds file and inline seeds with stable PR titles", async () => {
    const root = mkdtempSync(join(tmpdir(), "intent-builder-"));
    const seed = join(root, "Seed Name.md");
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
      worktree: { branchName: "intent/seed-name", baseRef: "trunk" },
      creationTitle: "intent: Seed Name",
    });
    expect(inline.steps[0]).toMatchObject({
      role: "plan",
      promptId: "intent.prompt.split",
      creationTitle: "intent: improve-api",
    });
    expect(file.steps[0]).toMatchObject({
      landing: { inputs: { sourceRoot: root, paths: [seed], consumeFrom: "worktree" } },
    });
    expect(inline.steps[0]).toMatchObject({ landing: { inputs: { paths: [], consumeFrom: "worktree" } } });
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

  test("routes committed intent output from canonical seeds before configured targets", async () => {
    const root = mkdtempSync(join(tmpdir(), "intent-routing-"));
    const config = join(root, "config.json");
    for (const { targetDir, configuredTargetDir } of [
      { targetDir: "v1/spec", configuredTargetDir: "v2/spec" },
      { targetDir: "v2/spec", configuredTargetDir: "v1/spec" },
    ]) {
      writeFileSync(
        config,
        JSON.stringify({ projects: { demo: { root } }, modes: { plan: { targetDir: configuredTargetDir } } }),
      );
      const seed = join(root, targetDir, "seeds", "feature.md");
      mkdirSync(join(root, targetDir, "seeds"), { recursive: true });
      writeFileSync(seed, "feature", "utf8");
      for (const [name, build] of [
        ["intent", buildIntentWorkflowSteps],
        ["intent-reviewed", buildReviewedIntentWorkflowSteps],
      ] as const) {
        const result = await build({ cwd: root, seed: join(targetDir, "seeds", "feature.md"), configPath: config }, {
          loadWorkflowSteps: load,
          resolveBaseBranch: () => "trunk",
        });
        expect(result.ok, name).toBe(true);
        if (result.ok) expect(result.steps[0]).toMatchObject({ specPath: `${targetDir}/ready-intents` });
      }
    }
  });

  test("preserves explicit, inline, and non-canonical target routing", async () => {
    const root = mkdtempSync(join(tmpdir(), "intent-routing-"));
    const config = join(root, "config.json");
    mkdirSync(join(root, "notes"), { recursive: true });
    writeFileSync(join(root, "notes", "feature.md"), "feature", "utf8");
    writeFileSync(
      config,
      JSON.stringify({ projects: { demo: { root } }, modes: { plan: { targetDir: "v2/spec" } } }),
    );
    mkdirSync(join(root, "v2/spec/seeds"), { recursive: true });
    writeFileSync(join(root, "v2/spec/seeds/override.md"), "override", "utf8");
    const cases = [
      { input: { seedText: "inline" }, expected: "v2/spec/ready-intents" },
      { input: { seed: "notes/feature.md" }, expected: "v2/spec/ready-intents" },
      { input: { seed: "v2/spec/seeds/override.md", targetDir: "v1/spec" }, expected: "v1/spec/ready-intents" },
      { input: { seedText: "override", targetDir: "v1/spec" }, expected: "v1/spec/ready-intents" },
    ];
    for (const { input, expected } of cases) {
      const result = await buildIntentWorkflowSteps(
        { cwd: root, configPath: config, ...input },
        { loadWorkflowSteps: load, resolveBaseBranch: () => "trunk" },
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.steps[0]).toMatchObject({ specPath: expected });
    }

    const defaultResult = await buildIntentWorkflowSteps(
      { cwd: root, seedText: "default" },
      { resolveProjectMatch: () => ({ ...match, root }), loadWorkflowSteps: load, resolveBaseBranch: () => "trunk" },
    );
    expect(defaultResult.ok).toBe(true);
    if (defaultResult.ok) expect(defaultResult.steps[0]).toMatchObject({ specPath: "spec/ready-intents" });
  });

  test("keeps canonical seed output external when git is disabled", async () => {
    const root = mkdtempSync(join(tmpdir(), "intent-routing-"));
    const config = join(root, "config.json");
    mkdirSync(join(root, "v1/spec/seeds"), { recursive: true });
    writeFileSync(join(root, "v1/spec/seeds/feature.md"), "feature", "utf8");
    writeFileSync(config, JSON.stringify({ projects: { demo: { root, git: false } } }));

    const result = await buildIntentWorkflowSteps(
      { cwd: root, seed: "v1/spec/seeds/feature.md", configPath: config, jarvisRoot: "/jarvis" },
      { loadWorkflowSteps: load },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.steps[0]).toMatchObject({ specPath: "/jarvis/specs/demo/ready-intents" });
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

    const negative = await buildReviewedIntentWorkflowSteps({ cwd: "/repo", seedText: "x", reviewPasses: -1 }, deps);
    expect(negative.ok).toBe(false);
    if (!negative.ok) expect(negative.error).toContain("non-negative integer");

    const fractional = await buildReviewedIntentWorkflowSteps({ cwd: "/repo", seedText: "x", reviewPasses: 1.5 }, deps);
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

  test("loads mixed reviewed intent sources once with forwarded machine options", async () => {
    const root = mkdtempSync(join(tmpdir(), "reviewed-intent-"));
    writeFileSync(join(root, "test.md"), "test", "utf8");
    const calls: { steps: readonly WorkflowSourceStep[]; options: unknown }[] = [];
    const createBinding = () => ({
      id: "bound",
      invoke: async () => ({ kind: "error" as const, exitCode: 1, stderr: "" }),
    });

    const result = await buildReviewedIntentWorkflowSteps(
      { cwd: root, seed: "test.md", targetDir: "specs", reviewPasses: 3, jarvisRoot: "/jarvis" },
      {
        resolveProjectMatch: () => ({ ...match, root }),
        loadWorkflowSteps: (steps, options) => {
          calls.push({ steps, options });
          return load(steps);
        },
        resolveBaseBranch: () => "trunk",
        machineConfigPath: "/config.json",
        machineProfile: "local",
        machinesDir: "/machines",
        createBinding,
      },
    );

    if (!result.ok) {
      throw new Error(`Expected ok=true, got error: ${result.error}`);
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      options: { machineConfigPath: "/config.json", machineProfile: "local", machinesDir: "/machines" },
      steps: [
        { behavior: "write", stepId: "intent", role: "plan" },
        { behavior: "review", stepId: "review", prompt: "intent.prompt.review", createBinding },
      ],
    });
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]).toMatchObject({ behavior: "write", role: "plan", stepId: "intent" });
    expect(result.steps[0]).toMatchObject({ creationTitle: "intent: test" });

    const reviewStep = result.steps[1] as ReviewWorkflowStep;
    expect(reviewStep).toMatchObject({
      behavior: "review",
      stepId: "review",
      maxCycles: 3,
      cwd: "/jarvis/worktrees/demo/intent/test",
      verdictPath: "/jarvis/worktrees/demo/intent/test/.jarvis-intent-review-verdict.md",
      agents: {
        critic: ["claude"],
        actuator: ["claude"],
      },
      createBinding,
      landing: {
        kind: "intent-stage",
        output: { durableDir: "specs/ready-intents" },
        stagingDir: ".jarvis-intent-stage",
        invocationId: expect.any(String),
        baseRef: "trunk",
      },
    });
  });

  test("uses the split step local workspace for every reviewed intent path when git is disabled", async () => {
    const root = mkdtempSync(join(tmpdir(), "reviewed-intent-"));
    const config = join(root, "config.json");
    writeFileSync(config, JSON.stringify({ projects: { demo: { root, git: false } } }));

    const result = await buildReviewedIntentWorkflowSteps(
      { cwd: root, seedText: "one thing", configPath: config, jarvisRoot: "/jarvis" },
      { loadWorkflowSteps: load },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const workspace = "/jarvis/intent-work/demo/one-thing";
    const reviewStep = result.steps[1];
    if (reviewStep?.behavior !== "review") throw new Error("expected review step");
    expect(reviewStep).toMatchObject({
      cwd: workspace,
      verdictPath: `${workspace}/.jarvis-intent-review-verdict.md`,
      landing: {
        kind: "intent-stage",
        output: { durableDir: "/jarvis/specs/demo/ready-intents" },
        stagingDir: ".jarvis-intent-stage",
        invocationId: expect.any(String),
        baseRef: "none",
      },
    });
  });

  test("returns unchanged loader failures before daemon contact", async () => {
    const root = mkdtempSync(join(tmpdir(), "reviewed-intent-"));
    writeFileSync(join(root, "test.md"), "test", "utf8");
    let calls = 0;

    const result = await buildReviewedIntentWorkflowSteps(
      { cwd: root, seed: "test.md", targetDir: "specs", reviewPasses: 1 },
      {
        resolveProjectMatch: () => ({ ...match, root }),
        loadWorkflowSteps: () => {
          calls += 1;
          throw new Error("Workflow step role validation failed: missing binding (review, critic, claude)");
        },
        resolveBaseBranch: () => "trunk",
      },
    );

    expect(calls).toBe(1);
    expect(result).toEqual({
      ok: false,
      error: "Workflow step role validation failed: missing binding (review, critic, claude)",
    });
  });
});
