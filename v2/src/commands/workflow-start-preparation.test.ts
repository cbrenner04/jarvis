import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BASE_WORKFLOW_NAMES,
  isUnrealizableWorkflowReview,
  resolveWorkflowPresetName,
  WORKFLOW_REVIEW_POSTURES,
} from "./workflow-start-preparation.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const OWNER_PATH = "v2/src/commands/workflow-start-preparation.ts";

function productionSources(): string[] {
  const sources: string[] = [];
  const walk = (directory: string, relativeDirectory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(join(directory, entry.name), relativePath);
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        sources.push(relativePath);
      }
    }
  };
  walk(join(REPO_ROOT, "v2/src"), "v2/src");
  return sources.sort();
}

describe("workflow-start preparation authority", () => {
  test("realizes every supported workflow and review posture", () => {
    expect(BASE_WORKFLOW_NAMES).toEqual(["intent", "plan", "implement"]);
    expect(WORKFLOW_REVIEW_POSTURES).toEqual(["none", "light", "debate"]);
    expect(resolveWorkflowPresetName("intent", "none")).toBe("intent");
    expect(resolveWorkflowPresetName("intent", "light")).toBe("intent-reviewed");
    expect(resolveWorkflowPresetName("intent", "debate")).toBe("intent");
    expect(resolveWorkflowPresetName("plan", "none")).toBe("plan");
    expect(resolveWorkflowPresetName("plan", "light")).toBe("plan-reviewed-light");
    expect(resolveWorkflowPresetName("plan", "debate")).toBe("plan-reviewed");
    expect(resolveWorkflowPresetName("implement", "none")).toBeUndefined();
    expect(resolveWorkflowPresetName("implement", "light")).toBe("implement");
    expect(resolveWorkflowPresetName("implement", "debate")).toBe("implement");
    expect(isUnrealizableWorkflowReview("implement", "none")).toBe(true);
  });

  test("production realizability and posture-to-preset tables live only in the shared owner", () => {
    const forbiddenDeclarations = [
      /function\s+isUnrealizableWorkflowReview\s*\(/,
      /const\s+WORKFLOW_POSTURE_PRESETS\b/,
      /workflow\s*===\s*["']implement["']\s*&&\s*review\s*===\s*["']none["']/,
      /intent\s*:\s*\{\s*none\s*:\s*["']intent["']/,
    ];

    for (const path of productionSources()) {
      if (path === OWNER_PATH) continue;
      const source = readFileSync(join(REPO_ROOT, path), "utf8");
      for (const declaration of forbiddenDeclarations) {
        expect(source).not.toMatch(declaration);
      }
    }

    const definitionSource = readFileSync(join(REPO_ROOT, "v2/src/execution/pipeline-definition.ts"), "utf8");
    expect(definitionSource).toContain('from "../commands/workflow-start-preparation.ts"');
    expect(definitionSource).toContain("isUnrealizableWorkflowReview(workflow, review)");

    const resolverSource = readFileSync(join(REPO_ROOT, "v2/src/daemon/pipeline-stage-resolve.ts"), "utf8");
    expect(resolverSource).toContain('from "../commands/workflow-start-preparation.ts"');
    expect(resolverSource).toContain("resolveWorkflowPresetName(stage.workflow, stage.review)");
  });
});
