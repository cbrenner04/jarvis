import { describe, expect, test } from "bun:test";
import type { ProjectMatch } from "../../../shared/project-registry.ts";
import { buildPlanWorkflowSteps, buildReviewedPlanWorkflowSteps } from "./plan-workflow-steps.ts";
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
      { cwd: "/repo", readyIntent: "spec/ready-intents/reviewed-plan.md", jarvisRoot: "/jarvis" },
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
        /^\/jarvis\/worktrees\/demo\/plan\/reviewed-plan\/spec\/\d{8}T\d{6}Z-reviewed-plan\/verdict-plan\.md$/,
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
});
