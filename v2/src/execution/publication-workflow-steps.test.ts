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

test("plan specs decision honors project specs: external like intent", async () => {
  const root = mkdtempSync(join(tmpdir(), "plan-specs-external-"));
  const jarvisRoot = join(root, "jarvis");
  const configPath = writeMachineConfig({
    projects: { demo: { root, specs: "external" } },
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
  const externalReadContextPath = join(jarvisRoot, "specs", projectSafeId("demo"), "plans", "feature-read-context");
  expect(result.steps[0]).toMatchObject({
    specPath: externalPlanPath,
    worktree: { git: false, localPath: externalReadContextPath, materializeReadCheckout: true },
    publishCompletion: false,
    landing: { inputs: { consumeFrom: "source" }, durablePath: externalPlanPath },
  });
});

test("external plan draft materializes a read checkout at the stage dir with a real base", async () => {
  const root = mkdtempSync(join(tmpdir(), "plan-specs-external-readctx-"));
  const jarvisRoot = join(root, "jarvis");
  const configPath = writeMachineConfig({ projects: { demo: { root, specs: "external" } } });
  const readyIntent = "spec/ready-intents/feature.md";
  mkdirSync(join(root, "spec/ready-intents"), { recursive: true });
  writeFileSync(join(root, readyIntent), "---\nname: feature\n---\n\n## Prerequisites\n", "utf8");

  const result = await buildPlanWorkflowSteps(
    { cwd: root, readyIntent, configPath, jarvisRoot, reviewPasses: 0 },
    { resolveProjectMatch: () => project, loadWorkflowSteps: load, resolveBaseBranch: () => "trunk" },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const step = result.steps[0];
  if (step?.behavior !== "write") throw new Error("expected write step");
  const externalPlanPath = join(jarvisRoot, "specs", projectSafeId("demo"), "plans", "feature");
  const externalReadContextPath = join(jarvisRoot, "specs", projectSafeId("demo"), "plans", "feature-read-context");
  // WORKDIR advertises the read-context checkout dir the agent is invoked in — distinct from the
  // durable landing target and never the never-created managed worktree.
  expect(step.promptPlaceholders?.WORKDIR).toBe(externalReadContextPath);
  expect(step.promptPlaceholders?.WORKDIR).not.toBe(externalPlanPath);
  expect(step.promptPlaceholders?.WORKDIR).not.toMatch(/worktrees\//);
  expect(step.worktree.localPath).toBe(externalReadContextPath);
  expect(step.specPath).toBe(externalPlanPath);
  expect(step.worktree.materializeReadCheckout).toBe(true);
  // A real base ref, never the `"none"` sentinel that would fail archive extraction.
  expect(step.worktree.baseRef).toBe("trunk");
});

test("plan build publishes in-repo when the project sets specs: repo", async () => {
  const root = mkdtempSync(join(tmpdir(), "plan-specs-repo-"));
  const configPath = writeMachineConfig({ projects: { demo: { root, specs: "repo" } } });
  const readyIntent = "spec/ready-intents/feature.md";
  mkdirSync(join(root, "spec/ready-intents"), { recursive: true });
  writeFileSync(join(root, readyIntent), "---\nname: feature\n---\n\n## Prerequisites\n", "utf8");

  const result = await buildPlanWorkflowSteps(
    { cwd: root, readyIntent, configPath, reviewPasses: 0 },
    { resolveProjectMatch: () => project, loadWorkflowSteps: load, resolveBaseBranch: () => "trunk" },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.steps[0]).toMatchObject({
    specPath: expect.stringMatching(/^spec\/\d{8}T\d{6}Z-feature$/),
    publishCompletion: true,
  });
  const writeStep = result.steps[0];
  if (writeStep?.behavior !== "write") throw new Error("expected write step");
  expect(writeStep.worktree.git).toBeUndefined();
  // specs: repo keeps the managed-worktree WORKDIR and never requests a read checkout.
  expect(writeStep.promptPlaceholders?.WORKDIR).toMatch(/worktrees\/demo\/plan\/feature$/);
  expect(writeStep.worktree.materializeReadCheckout).toBeUndefined();
  expect(writeStep.worktree.localPath).toBeUndefined();
});

test.each([
  ["intent", "intent-specs-absent-"],
  ["plan", "plan-specs-absent-"],
] as const)("%s build defaults to the external specs home when the project has no specs key", async (kind, prefix) => {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const jarvisRoot = join(root, "jarvis");
  const configPath = writeMachineConfig({ projects: { demo: { root } } });
  const readyIntent = "spec/ready-intents/feature.md";
  mkdirSync(join(root, "spec/ready-intents"), { recursive: true });
  writeFileSync(join(root, readyIntent), "---\nname: feature\n---\n\n## Prerequisites\n", "utf8");
  const result =
    kind === "intent"
      ? await buildIntentWorkflowSteps(
          { cwd: root, seedText: "one thing", configPath, jarvisRoot },
          { resolveProjectMatch: () => project, loadWorkflowSteps: load },
        )
      : await buildPlanWorkflowSteps(
          { cwd: root, readyIntent, configPath, jarvisRoot, reviewPasses: 0 },
          { resolveProjectMatch: () => project, loadWorkflowSteps: load },
        );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const writeStep = result.steps[0];
  if (writeStep?.behavior !== "write") throw new Error("expected write step");
  expect(writeStep.worktree.git).toBe(false);
  expect(writeStep.worktree.localPath?.startsWith(jarvisRoot)).toBe(true);
});

test("plan build rejects project plan.commit, naming specs", async () => {
  const root = mkdtempSync(join(tmpdir(), "plan-legacy-plan-commit-"));
  const configPath = writeMachineConfig({ projects: { demo: { root, plan: { commit: false } } } });
  const readyIntent = "spec/ready-intents/feature.md";
  mkdirSync(join(root, "spec/ready-intents"), { recursive: true });
  writeFileSync(join(root, readyIntent), "---\nname: feature\n---\n\n## Prerequisites\n", "utf8");

  const result = await buildPlanWorkflowSteps(
    { cwd: root, readyIntent, configPath, reviewPasses: 0 },
    { resolveProjectMatch: () => project, loadWorkflowSteps: load },
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toContain("specs");
});

test("plan build rejects machine modes.plan.commit, naming specs", async () => {
  const root = mkdtempSync(join(tmpdir(), "plan-legacy-modes-commit-"));
  const configPath = writeMachineConfig({
    projects: { demo: { root } },
    modes: { plan: { commit: false } },
  });
  const readyIntent = "spec/ready-intents/feature.md";
  mkdirSync(join(root, "spec/ready-intents"), { recursive: true });
  writeFileSync(join(root, readyIntent), "---\nname: feature\n---\n\n## Prerequisites\n", "utf8");

  const result = await buildPlanWorkflowSteps(
    { cwd: root, readyIntent, configPath, reviewPasses: 0 },
    { resolveProjectMatch: () => project, loadWorkflowSteps: load },
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toContain("specs");
});

test("intent build rejects project plan.commit, naming specs", async () => {
  const root = mkdtempSync(join(tmpdir(), "intent-legacy-plan-commit-"));
  const configPath = writeMachineConfig({ projects: { demo: { root, plan: { commit: false } } } });

  const result = await buildIntentWorkflowSteps(
    { cwd: root, seedText: "one thing", configPath },
    { resolveProjectMatch: () => project, loadWorkflowSteps: load },
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toContain("specs");
});
