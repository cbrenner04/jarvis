import { describe, expect, test } from "bun:test";
import type { ProjectMatch } from "../../../shared/project-registry.ts";
import { buildIntentWorkflowSteps, buildPlanWorkflowSteps } from "./publication-workflow-steps.ts";
import type { LoadedWorkflowStep, WorkflowSourceStep } from "./workflow-loader.ts";

const project: ProjectMatch = { key: "demo", root: "/repo" };
const load = (steps: readonly WorkflowSourceStep[]) =>
  steps.map((step) => ({ ...step, agents: ["claude"], agentModelConfig: {} })) as LoadedWorkflowStep[];

describe("publication rows", () => {
  test.each([
    [
      "intent",
      () =>
        buildIntentWorkflowSteps(
          { cwd: "/repo", seedText: "Ship feature" },
          { resolveProjectMatch: () => project, loadWorkflowSteps: load },
        ),
    ],
    [
      "plan",
      () =>
        buildPlanWorkflowSteps(
          { cwd: "/repo", readyIntent: "spec/ready-intents/feature.md" },
          {
            resolveProjectMatch: () => project,
            readReadyIntent: () => ({ ok: true as const, name: "feature", content: "## Prerequisites\n" }),
            loadWorkflowSteps: load,
          },
        ),
    ],
  ] as const)("selects the %s publication definition", async (kind, build) => {
    const result = await build();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps[0]).toMatchObject({
      behavior: "write",
      role: "plan",
      promptId: kind === "intent" ? "intent.prompt.split" : "plan.prompt.draft",
      expectedArtifactPath: kind === "intent" ? ".jarvis-intent-stage" : ".jarvis-plan-stage",
    });
  });
});
