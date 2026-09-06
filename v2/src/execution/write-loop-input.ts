import { parseArgs } from "node:util";
import { DEFAULT_WRITE_STEP_RULES } from "../../../shared/prompts/step-rules.ts";
import { WRITE_PARSE_ARG_OPTIONS } from "../cli/command-help-flags.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import type { WriteLoopInput } from "./write-loop.ts";

export { DEFAULT_WRITE_STEP_RULES };

/**
 * Restores a killing-test authoring instruction to implement (and mutation-repair) prompts, reworded
 * clear of the retired `@mutate`/checkpoint DSL. The diff-derived mutation gate still requires a
 * co-located test that fails when a changed guard is inverted; without this line agents stopped
 * authoring those tests and the diff-derived mutation gate misses uncovered guards at implement `done`.
 */
const KILLING_TEST_RULE =
  "When you add or change a comparison operator, boolean guard, or branch condition in production code, add or extend a test that fails when that guard is inverted (for example flipping `===`/`!==`, `<`/`>=`, or dropping a negation). Put it in the file's co-located `<file>.test.ts` or an existing sibling `<file>-*.test.ts` in the same directory; when no co-located test covers the guard, a direct-importing `*.test.ts` under the same test-surface root (`v1/src/`, `v2/src/`, or `shared/`) suffices — the diff-derived mutation gate resolves co-located killing tests first and runs importer discovery only when that union is empty at implement `done`, not only at publication, and not from the wider suite or transitive importers. Do not use production invert hooks.";

/**
 * Agents routinely trip biome `lint/complexity/noExcessiveCognitiveComplexity` (max 24) on a new
 * branchy function, stranding the completion commit. Pre-empt it: keep new functions under the limit,
 * else add an inline ignore so neither the commit nor the ready gate strands.
 */
const COGNITIVE_COMPLEXITY_RULE =
  "Keep every new or changed function under biome's cognitive-complexity limit (`noExcessiveCognitiveComplexity`, max 24). If a function is unavoidably over the limit, add `// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: <reason>` on the line directly above the function declaration (or extract a helper, preserving guard text so mutation tests still match). Do not leave an over-complexity function un-annotated — it fails the completion commit and the ready gate, neither of which can autofix it.";

export const IMPLEMENT_WRITE_STEP_RULES = `${DEFAULT_WRITE_STEP_RULES}\n${KILLING_TEST_RULE}\n${COGNITIVE_COMPLEXITY_RULE}`;

/** Default agent list when config has no `agents` override. */
export const DEFAULT_WRITE_AGENTS = ["claude"] as const;

/** Raw launch field values shared by CLI argv mapping and the TUI collector. */
export type WriteLaunchFieldValues = {
  projectRoot: string;
  projectName: string;
  branchName: string;
  baseRef: string;
  specPath: string;
  artifactPath: string;
  /** Positive integer string; omitted leaves `maxIterations` unset on the payload. */
  maxIterations?: string;
};

type BuildWriteLoopInputResult = { ok: true; input: WriteLoopInput } | { ok: false };

type RequiredLaunchFields = {
  projectRoot: string;
  projectName: string;
  branchName: string;
  baseRef: string;
  specPath: string;
  artifactPath: string;
  agents: readonly string[];
};

/** Map validated launch fields to the daemon `start` / foreground write payload. */
export function buildWriteLoopInput(
  fields: Partial<WriteLaunchFieldValues>,
  agentModelConfig: AgentModelConfig,
  fallbackAgents?: readonly string[],
): BuildWriteLoopInputResult {
  const required = requireLaunchFields(fields, fallbackAgents);
  const maxIterations = parseMaxIterations(fields.maxIterations);

  if (required === null || maxIterations === null) {
    return { ok: false };
  }

  const input: WriteLoopInput = {
    worktree: {
      projectRoot: required.projectRoot,
      projectName: required.projectName,
      branchName: required.branchName,
      baseRef: required.baseRef,
    },
    specPath: required.specPath,
    stepRules: IMPLEMENT_WRITE_STEP_RULES,
    expectedArtifactPath: required.artifactPath,
    bindings: [],
    bindingResolution: { role: "implement", agents: required.agents, agentModelConfig },
  };

  return maxIterations === undefined ? { ok: true, input } : { ok: true, input: { ...input, maxIterations } };
}

/** Map `parseArgs` write/run-start flag values to {@link buildWriteLoopInput}. */
export function buildWriteLoopInputFromCliValues(
  values: Record<string, string | boolean | string[] | undefined>,
  agentModelConfig: AgentModelConfig,
  fallbackAgents?: readonly string[],
): BuildWriteLoopInputResult {
  return buildWriteLoopInput(toLaunchFields(values), agentModelConfig, fallbackAgents);
}

/** CLI flag names accepted by `jarvis run start`. */
export function parseWriteArgs(argv: readonly string[]): Record<string, string | boolean | string[] | undefined> {
  return parseArgs({
    args: [...argv],
    allowPositionals: false,
    strict: true,
    options: WRITE_PARSE_ARG_OPTIONS,
  }).values;
}

function requireLaunchFields(
  fields: Partial<WriteLaunchFieldValues>,
  fallbackAgents?: readonly string[],
): RequiredLaunchFields | null {
  const projectRoot = requireString(fields.projectRoot);
  const projectName = requireString(fields.projectName);
  const branchName = requireString(fields.branchName);
  const baseRef = requireString(fields.baseRef);
  const specPath = requireString(fields.specPath);
  const artifactPath = requireString(fields.artifactPath);
  const agents = fallbackAgents ?? DEFAULT_WRITE_AGENTS;

  if (
    projectRoot === undefined ||
    projectName === undefined ||
    branchName === undefined ||
    baseRef === undefined ||
    specPath === undefined ||
    artifactPath === undefined
  ) {
    return null;
  }

  return { projectRoot, projectName, branchName, baseRef, specPath, artifactPath, agents };
}

function requireString(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

function parseMaxIterations(raw: string | undefined): number | undefined | null {
  if (raw === undefined) return undefined;
  const maxIterations = Number.parseInt(raw, 10);
  return Number.isNaN(maxIterations) || maxIterations < 1 ? null : maxIterations;
}

function toLaunchFields(
  values: Record<string, string | boolean | string[] | undefined>,
): Partial<WriteLaunchFieldValues> {
  const fields: Partial<WriteLaunchFieldValues> = {};
  const assign = <K extends keyof WriteLaunchFieldValues>(key: K, value: string | undefined): void => {
    if (value !== undefined) fields[key] = value;
  };

  assign("projectRoot", stringValue(values["project-root"]));
  assign("projectName", stringValue(values.project));
  assign("branchName", stringValue(values.branch));
  assign("baseRef", stringValue(values.base));
  assign("specPath", stringValue(values.spec));
  assign("artifactPath", stringValue(values.artifact));
  assign("maxIterations", stringValue(values["max-iterations"]));
  return fields;
}

function stringValue(value: string | boolean | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}
