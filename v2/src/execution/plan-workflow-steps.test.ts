import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import type { ProjectMatch } from "../../../shared/project-registry.ts";
import { loadPromptRegistry } from "../../../shared/prompts/registry.ts";
import { createFakeWithExternalWorktree, createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
import {
  buildPlanWorkflowSteps,
  buildReviewedPlanLightWorkflowSteps,
  buildReviewedPlanWorkflowSteps,
  type PlanWorkflowDeps,
  type PlanWorkflowResult,
} from "./plan-workflow-steps.ts";
import type { LoadedWorkflowStep, WorkflowSourceStep } from "./workflow-loader.ts";
import type { WriteWorkflowStep } from "./workflow-runner.ts";
import { executeWrite } from "./write.ts";

const match: ProjectMatch = { key: "demo", root: "/repo" };
const intent = {
  ok: true as const,
  name: "reviewed-plan",
  content: "---\nname: reviewed-plan\n---\n\n## Prerequisites\n",
};

const load = (steps: readonly WorkflowSourceStep[]): LoadedWorkflowStep[] =>
  steps.map((step) =>
    step.behavior === "write"
      ? { ...step, agents: ["claude"], agentModelConfig: {} }
      : step.behavior === "review"
        ? { ...step, agents: { critic: ["claude"], actuator: ["claude"] }, agentModelConfig: {} }
        : {
            ...step,
            agents: { adversary: ["claude"], advocate: ["claude"], adjudicator: ["claude"], actuator: ["claude"] },
            agentModelConfig: {},
          },
  );

const builderDeps: PlanWorkflowDeps = {
  resolveProjectMatch: () => match,
  readReadyIntent: () => intent,
  resolveBaseBranch: () => "trunk",
  loadWorkflowSteps: load,
};

const { roots } = trackedTempRoots();
const specGuidance = readFileSync(join(import.meta.dir, "..", "..", "..", "v1", "docs", "spec-guidance.md"), "utf8");

async function executeBuiltDraftStep(
  build: (deps: PlanWorkflowDeps) => Promise<PlanWorkflowResult>,
): Promise<{ bindingInvoked: boolean; capturedPrompt: string; resultKind: string }> {
  const { jarvisRoot } = createJarvisHome();
  roots.push(join(jarvisRoot, ".."));
  let bindingInvoked = false;
  let capturedPrompt = "";
  const built = await build(builderDeps);
  expect(built.ok).toBe(true);
  if (!built.ok) throw new Error("build failed");
  const step = built.steps[0];
  if (step?.behavior !== "write") throw new Error("expected write step");
  const draftStep: WriteWorkflowStep = step;
  const bindings: InvocationBinding[] = [
    {
      id: "agent",
      invoke: async ({ prompt, cwd }) => {
        bindingInvoked = true;
        capturedPrompt = prompt;
        const specDir = join(cwd, draftStep.specPath);
        mkdirSync(specDir, { recursive: true });
        writeFileSync(join(specDir, "index.md"), "# Index\n", "utf8");
        writeFileSync(join(specDir, "00-first.md"), "## Acceptance criteria\n", "utf8");
        return { kind: "ok", stdout: "done", stderr: "" };
      },
    },
  ];
  const result = await executeWrite({
    worktree: draftStep.worktree,
    specPath: draftStep.specPath,
    stepRules: draftStep.stepRules,
    expectedArtifactPath: draftStep.expectedArtifactPath,
    bindings,
    withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
    ...(draftStep.promptId !== undefined ? { promptId: draftStep.promptId } : {}),
    ...(draftStep.promptPlaceholders !== undefined ? { promptPlaceholders: draftStep.promptPlaceholders } : {}),
    ...(draftStep.intentSeed !== undefined
      ? { intentSeed: draftStep.intentSeed, intentBefore: draftStep.intentSeed }
      : {}),
  });
  return { bindingInvoked, capturedPrompt, resultKind: result.result.kind };
}

describe("plan preset draft write step", () => {
  const input = { cwd: "/repo", readyIntent: "spec/ready-intents/reviewed-plan.md" };

  test.each([
    ["plan", buildPlanWorkflowSteps],
    ["plan-reviewed", buildReviewedPlanWorkflowSteps],
    ["plan-reviewed-light", buildReviewedPlanLightWorkflowSteps],
  ] as const)("`%s` invokes its binding through the production step-builder", async (_name, build) => {
    const { bindingInvoked, capturedPrompt, resultKind } = await executeBuiltDraftStep((deps) => build(input, deps));
    expect(bindingInvoked).toBe(true);
    expect(resultKind).toBe("complete");
    expect(capturedPrompt).toContain(specGuidance.slice(0, 80));
  });
});

describe("buildReviewedPlanWorkflowSteps", () => {
  test("defaults to one loaded draft-plus-debate workflow", async () => {
    const calls: (readonly WorkflowSourceStep[])[] = [];
    const result = await buildReviewedPlanWorkflowSteps(
      { cwd: "/repo", readyIntent: "spec/ready-intents/reviewed-plan.md" },
      {
        resolveProjectMatch: () => match,
        readReadyIntent: () => intent,
        resolveBaseBranch: () => "trunk",
        loadWorkflowSteps: (steps) => {
          calls.push(steps);
          return load(steps);
        },
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(2);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]).toMatchObject({ behavior: "write", promptId: "plan.prompt.draft" });
    expect(result.steps[1]).toMatchObject({
      behavior: "review-debate",
      stepId: "review-debate",
      maxCycles: 1,
      prompts: {
        adversary: "plan.prompt.review.adversary",
        advocate: "plan.prompt.review.advocate",
        adjudicator: "plan.prompt.review.adjudicator",
      },
      agents: { adversary: ["claude"], advocate: ["claude"], adjudicator: ["claude"], actuator: ["claude"] },
      verdictPath: expect.stringMatching(
        /worktrees\/demo\/plan\/reviewed-plan\/spec\/\d{8}T\d{6}Z-reviewed-plan\/verdict-plan\.md$/,
      ),
    });
  });

  test("uses requested positive passes and rejects invalid values before loading", async () => {
    let loaded = false;
    const deps = {
      resolveProjectMatch: () => match,
      readReadyIntent: () => intent,
      loadWorkflowSteps: (steps: readonly WorkflowSourceStep[]) => {
        loaded = true;
        return load(steps);
      },
    };
    const positive = await buildReviewedPlanWorkflowSteps(
      { cwd: "/repo", readyIntent: "spec/ready-intents/reviewed-plan.md", reviewPasses: 3 },
      deps,
    );
    expect(positive.ok).toBe(true);
    if (positive.ok) expect(positive.steps[1]).toMatchObject({ maxCycles: 3 });

    loaded = false;
    expect((await buildReviewedPlanWorkflowSteps({ cwd: "/repo", readyIntent: "x", reviewPasses: -1 }, deps)).ok).toBe(
      false,
    );
    expect(loaded).toBe(false);
  });

  test("delegates zero passes to the draft-only plan workflow", async () => {
    const result = await buildReviewedPlanWorkflowSteps(
      { cwd: "/repo", readyIntent: "spec/ready-intents/reviewed-plan.md", reviewPasses: 0 },
      { resolveProjectMatch: () => match, readReadyIntent: () => intent, loadWorkflowSteps: load },
    );
    const draft = await buildPlanWorkflowSteps(
      { cwd: "/repo", readyIntent: "spec/ready-intents/reviewed-plan.md" },
      { resolveProjectMatch: () => match, readReadyIntent: () => intent, loadWorkflowSteps: load },
    );
    expect(result).toMatchObject({ ok: true });
    expect(draft).toMatchObject({ ok: true });
    if (result.ok && draft.ok) {
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0]).toMatchObject({
        behavior: draft.steps[0]?.behavior,
        role: draft.steps[0]?.behavior === "write" ? draft.steps[0].role : undefined,
        promptId: draft.steps[0]?.behavior === "write" ? draft.steps[0].promptId : undefined,
      });
    }
  });

  test("points the debate step at the draft's actual localPath when project git is disabled", async () => {
    const root = mkdtempSync(join(tmpdir(), "plan-builder-"));
    const config = join(root, "config.json");
    writeFileSync(config, JSON.stringify({ projects: { demo: { root, git: false } } }));
    const result = await buildReviewedPlanWorkflowSteps(
      { cwd: root, readyIntent: "spec/ready-intents/reviewed-plan.md", configPath: config },
      { resolveProjectMatch: () => match, readReadyIntent: () => intent, loadWorkflowSteps: load },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const writeStep = result.steps[0];
    if (writeStep?.behavior !== "write") throw new Error("expected write step");
    const localPath = writeStep.worktree.localPath;
    expect(writeStep.worktree.git).toBe(false);
    expect(typeof localPath).toBe("string");
    expect(result.steps[1]).toMatchObject({ behavior: "review-debate", cwd: localPath });
    const debateStep = result.steps[1];
    if (debateStep?.behavior !== "review-debate") throw new Error("expected review-debate step");
    expect(debateStep.verdictPath.startsWith(`${localPath}/`)).toBe(true);
  });
});

describe("buildReviewedPlanLightWorkflowSteps", () => {
  test("defaults to one loaded draft-plus-light-review workflow", async () => {
    const calls: (readonly WorkflowSourceStep[])[] = [];
    const result = await buildReviewedPlanLightWorkflowSteps(
      { cwd: "/repo", readyIntent: "spec/ready-intents/reviewed-plan.md" },
      {
        resolveProjectMatch: () => match,
        readReadyIntent: () => intent,
        resolveBaseBranch: () => "trunk",
        loadWorkflowSteps: (steps) => {
          calls.push(steps);
          return load(steps);
        },
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(2);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]).toMatchObject({ behavior: "write", promptId: "plan.prompt.draft" });
    expect(result.steps[1]).toMatchObject({
      behavior: "review",
      stepId: "plan-review",
      maxCycles: 1,
      agents: { critic: ["claude"], actuator: ["claude"] },
      verdictPath: expect.stringMatching(
        /worktrees\/demo\/plan\/reviewed-plan\/spec\/\d{8}T\d{6}Z-reviewed-plan\/verdict-plan\.md$/,
      ),
      planReviewContext: expect.objectContaining({
        specPath: expect.stringMatching(/\/spec\/\d{8}T\d{6}Z-reviewed-plan$/),
      }),
    });
  });

  test("wires plan light-review prompt ids and verdict path for positive passes", () => {
    const registry = loadPromptRegistry();
    expect(registry.getById("plan.prompt.review.critic")).toBeDefined();
    expect(registry.getById("plan.prompt.review-actuator")).toBeDefined();
  });

  test("uses requested positive passes and rejects invalid values before loading", async () => {
    let loaded = false;
    const deps = {
      resolveProjectMatch: () => match,
      readReadyIntent: () => intent,
      loadWorkflowSteps: (steps: readonly WorkflowSourceStep[]) => {
        loaded = true;
        return load(steps);
      },
    };
    const positive = await buildReviewedPlanLightWorkflowSteps(
      { cwd: "/repo", readyIntent: "spec/ready-intents/reviewed-plan.md", reviewPasses: 3 },
      deps,
    );
    expect(positive.ok).toBe(true);
    if (positive.ok) expect(positive.steps[1]).toMatchObject({ maxCycles: 3 });

    loaded = false;
    expect(
      (await buildReviewedPlanLightWorkflowSteps({ cwd: "/repo", readyIntent: "x", reviewPasses: -1 }, deps)).ok,
    ).toBe(false);
    expect(loaded).toBe(false);
  });

  test("delegates zero passes to the draft-only plan workflow", async () => {
    const result = await buildReviewedPlanLightWorkflowSteps(
      { cwd: "/repo", readyIntent: "spec/ready-intents/reviewed-plan.md", reviewPasses: 0 },
      { resolveProjectMatch: () => match, readReadyIntent: () => intent, loadWorkflowSteps: load },
    );
    const draft = await buildPlanWorkflowSteps(
      { cwd: "/repo", readyIntent: "spec/ready-intents/reviewed-plan.md" },
      { resolveProjectMatch: () => match, readReadyIntent: () => intent, loadWorkflowSteps: load },
    );
    expect(result).toMatchObject({ ok: true });
    expect(draft).toMatchObject({ ok: true });
    if (result.ok && draft.ok) {
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0]).toMatchObject({
        behavior: draft.steps[0]?.behavior,
        role: draft.steps[0]?.behavior === "write" ? draft.steps[0].role : undefined,
        promptId: draft.steps[0]?.behavior === "write" ? draft.steps[0].promptId : undefined,
      });
    }
  });

  test("points the review step at the draft's actual localPath when project git is disabled", async () => {
    const root = mkdtempSync(join(tmpdir(), "plan-builder-"));
    const config = join(root, "config.json");
    writeFileSync(config, JSON.stringify({ projects: { demo: { root, git: false } } }));
    const result = await buildReviewedPlanLightWorkflowSteps(
      { cwd: root, readyIntent: "spec/ready-intents/reviewed-plan.md", configPath: config },
      { resolveProjectMatch: () => match, readReadyIntent: () => intent, loadWorkflowSteps: load },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const writeStep = result.steps[0];
    if (writeStep?.behavior !== "write") throw new Error("expected write step");
    const localPath = writeStep.worktree.localPath;
    expect(writeStep.worktree.git).toBe(false);
    expect(typeof localPath).toBe("string");
    expect(result.steps[1]).toMatchObject({ behavior: "review", cwd: localPath });
    const reviewStep = result.steps[1];
    if (reviewStep?.behavior !== "review") throw new Error("expected review step");
    expect(reviewStep.verdictPath.startsWith(`${localPath}/`)).toBe(true);
  });
});
