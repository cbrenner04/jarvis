import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectMatch } from "../../../shared/project-registry.ts";
import { buildIntentWorkflowSteps } from "./intent-workflow-steps.ts";
import type { WorkflowSourceStep } from "./workflow-loader.ts";
import type { WriteWorkflowStep } from "./workflow-runner.ts";

const match: ProjectMatch = { key: "demo", root: "/repo" };
const load = (steps: readonly WorkflowSourceStep[]): WriteWorkflowStep[] =>
  steps.map((step) => ({ ...step, agents: ["claude"], agentModelConfig: {} }));

describe("buildIntentWorkflowSteps", () => {
  test("builds file and inline seeds as one plan step", async () => {
    const root = mkdtempSync(join(tmpdir(), "intent-builder-"));
    const seed = join(root, "Improve API.md");
    writeFileSync(seed, "seed", "utf8");
    const common = { cwd: root, targetDir: "specs" };
    const deps = { resolveProjectMatch: () => ({ ...match, root }), loadWorkflowSteps: load, resolveBaseBranch: () => "trunk" };

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
    expect((await buildIntentWorkflowSteps({ cwd: "/repo", seedText: "x", targetDir: "../spec" }, deps)).ok).toBe(false);
    expect(loaded).toBe(false);
  });

  test("uses external ready-intents storage when project git is disabled", async () => {
    const root = mkdtempSync(join(tmpdir(), "intent-builder-"));
    const config = join(root, "config.json");
    writeFileSync(config, JSON.stringify({ projects: { demo: { root, git: false } }, modes: { plan: { targetDir: "configured" } } }));
    const result = await buildIntentWorkflowSteps(
      { cwd: root, seedText: "one thing", targetDir: "override", configPath: config, jarvisRoot: "/jarvis" },
      { loadWorkflowSteps: load },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps[0]).toMatchObject({ specPath: "/jarvis/specs/demo/ready-intents", worktree: { baseRef: "none" } });
  });
});
