import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectMatch } from "../../../shared/project-registry.ts";
import { projectSafeId } from "../../../shared/project-safe-id.ts";
import { writeMachineConfig } from "../testing/cli-test-helpers.ts";
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

test("plan commit decision honors machine modes.plan.commit like intent", async () => {
  const root = mkdtempSync(join(tmpdir(), "plan-commit-machine-"));
  const jarvisRoot = join(root, "jarvis");
  const configPath = writeMachineConfig({
    projects: { demo: { root } },
    modes: { plan: { commit: false } },
  });
  const readyIntent = "spec/ready-intents/feature.md";
  mkdirSync(join(root, "spec/ready-intents"), { recursive: true });
  writeFileSync(join(root, readyIntent), "---\nname: feature\n---\n\n## Prerequisites\n", "utf8");

  const result = await buildPlanWorkflowSteps(
    { cwd: root, readyIntent, configPath, jarvisRoot, reviewPasses: 0 },
    { resolveProjectMatch: () => project, loadWorkflowSteps: load },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const externalPlanPath = join(jarvisRoot, "specs", projectSafeId("demo"), "plans", "feature");
  expect(result.steps[0]).toMatchObject({
    specPath: externalPlanPath,
    worktree: { git: false, localPath: externalPlanPath },
    publishCompletion: false,
    landing: { inputs: { consumeFrom: "source" } },
  });
});
