import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { locateDiscoveredFile, locateSymbolSlice } from "../../../shared/structural-test-locator.ts";
import { symbolResolvedMoveGuard } from "./structural-invariant-move-regression.test.ts";
import {
  BASE_WORKFLOW_NAMES,
  isBaseWorkflowName,
  isUnrealizableWorkflowReview,
  isWorkflowReviewPosture,
  resolveWorkflowPresetName,
  WORKFLOW_REVIEW_POSTURES,
} from "./workflow-start-preparation.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const OWNER_PATH = "v2/src/commands/workflow-start-preparation.ts";
const PIPELINE_ADAPTER_PATH = "v2/src/daemon/pipeline-workflow-preparation.ts";
const CLI_ADAPTER_PATH = "v2/src/commands/workflow.ts";
const PREPARE_CALL_PATTERN = /prepareWorkflowStart(?:<[^>]*>)?\s*\(/;
const PREPARE_CALL_ALLOWED_PATHS = [CLI_ADAPTER_PATH, OWNER_PATH, PIPELINE_ADAPTER_PATH];

/** Pre-fix hardcoded registry pins; vacuous when registries grow without a matching edit. */
const HAND_MAINTAINED_BASE_WORKFLOW_NAMES = ["intent", "plan", "implement"];
const HAND_MAINTAINED_REVIEW_POSTURES = ["none", "light", "debate"];

type ModuleSet = Readonly<Record<string, string>>;

function productionSourceMap(): ModuleSet {
  const sources: Record<string, string> = {};
  const walk = (directory: string, relativeDirectory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(join(directory, entry.name), relativePath);
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        sources[relativePath] = readFileSync(join(REPO_ROOT, relativePath), "utf8");
      }
    }
  };
  walk(join(REPO_ROOT, "v2/src"), "v2/src");
  return sources;
}

describe("workflow-start preparation authority", () => {
  test("realizes every supported workflow and review posture", () => {
    for (const workflow of BASE_WORKFLOW_NAMES) {
      expect(isBaseWorkflowName(workflow)).toBe(true);
    }
    for (const posture of WORKFLOW_REVIEW_POSTURES) {
      expect(isWorkflowReviewPosture(posture)).toBe(true);
    }
    expect([...BASE_WORKFLOW_NAMES]).not.toEqual(HAND_MAINTAINED_BASE_WORKFLOW_NAMES.slice(0, -1));
    expect([...WORKFLOW_REVIEW_POSTURES]).not.toEqual(HAND_MAINTAINED_REVIEW_POSTURES.slice(0, -1));

    const cells = BASE_WORKFLOW_NAMES.flatMap((workflow) =>
      WORKFLOW_REVIEW_POSTURES.map((posture) => ({ workflow, posture })),
    );
    const unrealizable = cells.filter(({ workflow, posture }) => isUnrealizableWorkflowReview(workflow, posture));
    expect(unrealizable).toHaveLength(1);
    expect(unrealizable[0]?.workflow).toBe("implement");
    expect(unrealizable[0]?.posture).toBe("none");

    for (const { workflow, posture } of cells) {
      const preset = resolveWorkflowPresetName(workflow, posture);
      if (isUnrealizableWorkflowReview(workflow, posture)) {
        expect(preset).toBeUndefined();
      } else {
        expect(preset).toBeDefined();
      }
    }

    expect(resolveWorkflowPresetName("intent", "none")).toBe("intent");
    expect(resolveWorkflowPresetName("intent", "light")).toBe("intent-reviewed");
    expect(resolveWorkflowPresetName("intent", "debate")).toBe("intent");
    expect(resolveWorkflowPresetName("plan", "none")).toBe("plan");
    expect(resolveWorkflowPresetName("plan", "light")).toBe("plan-reviewed-light");
    expect(resolveWorkflowPresetName("plan", "debate")).toBe("plan-reviewed");
    expect(resolveWorkflowPresetName("implement", "light")).toBe("implement");
    expect(resolveWorkflowPresetName("implement", "debate")).toBe("implement");
  });

  test("production realizability and posture-to-preset tables live only in the shared owner", () => {
    const forbiddenDeclarations = [
      /function\s+isUnrealizableWorkflowReview\s*\(/,
      /const\s+WORKFLOW_POSTURE_PRESETS\b/,
      /workflow\s*===\s*["']implement["']\s*&&\s*review\s*===\s*["']none["']/,
      /intent\s*:\s*\{\s*none\s*:\s*["']intent["']/,
    ];

    const modules = productionSourceMap();
    const ownerSource = locateDiscoveredFile(modules, OWNER_PATH);

    for (const [path, source] of Object.entries(modules)) {
      if (path === OWNER_PATH) continue;
      for (const declaration of forbiddenDeclarations) {
        expect(source).not.toMatch(declaration);
      }
    }

    const postureTableSlice = locateSymbolSlice({
      candidates: [ownerSource],
      start: "const WORKFLOW_POSTURE_PRESETS",
      end: "export function isBaseWorkflowName",
    });
    expect(postureTableSlice).toMatch(/intent\s*:\s*\{\s*none\s*:\s*["']intent["']/);

    const realizabilitySlice = locateSymbolSlice({
      candidates: [ownerSource],
      start: "export function isUnrealizableWorkflowReview",
      end: "export async function prepareWorkflowStart",
    });
    expect(realizabilitySlice).toMatch(/resolveWorkflowPresetName\(workflow, review\) === undefined/);

    const definitionSource = locateDiscoveredFile(modules, "v2/src/execution/pipeline-definition.ts");
    expect(definitionSource).toContain('from "../commands/workflow-start-preparation.ts"');
    expect(definitionSource).toContain("isUnrealizableWorkflowReview(workflow, review)");

    const resolverSource = locateDiscoveredFile(modules, "v2/src/daemon/pipeline-stage-resolve.ts");
    expect(resolverSource).toContain('from "../commands/workflow-start-preparation.ts"');
    expect(resolverSource).toContain("resolveWorkflowPresetName(stage.workflow, stage.review)");
  });

  test("production prepared-step assembly lives only in shared preparation and the pipeline adapter", () => {
    const modules = productionSourceMap();
    const prepareCallPaths = Object.entries(modules)
      .filter(([, source]) => PREPARE_CALL_PATTERN.test(source))
      .map(([path]) => path)
      .sort();
    expect(prepareCallPaths).toEqual([...PREPARE_CALL_ALLOWED_PATHS].sort());
    expect(prepareCallPaths).not.toEqual([OWNER_PATH, PIPELINE_ADAPTER_PATH].sort());

    expect(
      symbolResolvedMoveGuard(modules, {
        ownerPath: OWNER_PATH,
        adapterPaths: [CLI_ADAPTER_PATH, PIPELINE_ADAPTER_PATH],
        callPattern: PREPARE_CALL_PATTERN,
        ownerSymbolStart: "export async function prepareWorkflowStart",
        ownerSymbolEnd: "return prepared;",
      }),
    ).toBe(true);

    const forbiddenResolverAssembly = [
      /stampWorkflowStepsWithMachineConfig\s*\(/,
      /WORKFLOW_PRESET_BUILDERS\s*\[\s*\w+\s*\]\s*\(/,
      /WORKFLOW_PRESET_BUILDERS\s*\.\s*\w+\s*\(/,
      /invokePlanPresetBuilder/,
      /invokeImplementPresetBuilder/,
      /FIXED_REVIEW_PASSES/,
      /await\s+WORKFLOW_PRESET_BUILDERS/,
    ];
    const resolverSource = locateDiscoveredFile(modules, "v2/src/daemon/pipeline-stage-resolve.ts");
    for (const declaration of forbiddenResolverAssembly) {
      expect(resolverSource).not.toMatch(declaration);
    }
    expect(resolverSource).toContain("preparePipelineStageWorkflow");

    const pipelineAdapterSource = locateDiscoveredFile(modules, PIPELINE_ADAPTER_PATH);
    expect(pipelineAdapterSource).toContain("prepareWorkflowStart({");
  });
});
