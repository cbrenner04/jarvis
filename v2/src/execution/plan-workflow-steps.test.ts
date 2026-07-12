import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectMatch } from "../../../shared/project-registry.ts";
import { loadPromptRegistry } from "../../../shared/prompts/registry.ts";
import {
  buildPlanWorkflowSteps,
  buildReviewedPlanLightWorkflowSteps,
  buildReviewedPlanWorkflowSteps,
} from "./plan-workflow-steps.ts";
import type { LoadedWorkflowStep, WorkflowSourceStep } from "./workflow-loader.ts";

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
