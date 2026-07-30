import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  listIntentStageMarkdownFiles,
  validateIntentFilenames,
  validateIntentStageContent,
} from "../../../shared/intent-stage.ts";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import { INTENT_SPLIT_SURFACE_PIN } from "../../../shared/prompts/intent-split.ts";
import { createFakeWithExternalWorktree, createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
import { buildIntentWorkflowSteps } from "./publication-workflow-steps.ts";
import type { LoadedWorkflowStep, WorkflowSourceStep } from "./workflow-loader.ts";
import { executeWrite } from "./write.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const MULTI_SURFACE_SEED = join(import.meta.dir, "fixtures", "intent-split-multi-surface.md");
const SINGLE_SURFACE_SEED = join(import.meta.dir, "fixtures", "intent-split-single-surface.md");
const MULTI_SURFACE_SEED_CONTENT = readFileSync(MULTI_SURFACE_SEED, "utf8");
const SINGLE_SURFACE_SEED_CONTENT = readFileSync(SINGLE_SURFACE_SEED, "utf8");
const SINGLE_SURFACE_PIN =
  "if the seed touches exactly one module-boundary surface, emit exactly one intent, and state in one line in that intent's body why splitting does not apply";
const PRIMARY_SURFACES = [
  "v2/src/persistence/state-store.ts",
  "v2/src/daemon/daemon.ts",
  "v2/src/commands/run.ts",
] as const;
const EXECUTION_LOOP_SURFACE = "v2/src/execution/write-loop.ts";
const PERSISTENCE_BEHAVIOR = "Durable run admission exists.";
const DAEMON_BEHAVIOR = "Daemon requests reload admitted runs after restart.";

const { roots } = trackedTempRoots();

const load = (steps: readonly WorkflowSourceStep[]): LoadedWorkflowStep[] =>
  steps.map((step) =>
    step.behavior === "write"
      ? { ...step, agents: ["stub"], agentModelConfig: {} }
      : step.behavior === "review"
        ? { ...step, agents: { critic: ["stub"], actuator: ["stub"] }, agentModelConfig: {} }
        : {
            ...step,
            agents: {
              adversary: ["stub"],
              advocate: ["stub"],
              adjudicator: ["stub"],
              actuator: ["stub"],
            },
            agentModelConfig: {},
          },
  );

function normalize(text: string): string {
  return text.replace(/\s+/gu, " ").trim().toLowerCase();
}

function hasSurfaceContract(prompt: string): boolean {
  const normalized = normalize(prompt);
  return normalized.includes(INTENT_SPLIT_SURFACE_PIN) && normalized.includes(SINGLE_SURFACE_PIN);
}

function intent(
  name: string,
  title: string,
  primarySurfaces: readonly string[],
  body: string,
  prerequisites = "",
): string {
  return `---
name: ${name}
---

# ${title}

${body}

## Primary implementation surface

${primarySurfaces.join("\n")}

## Prerequisites

${prerequisites}`;
}

function writeMultiSurfaceStage(stage: string, revised: boolean): void {
  if (!revised) {
    writeFileSync(
      join(stage, "persist-and-list-run-admission.md"),
      intent(
        "persist-and-list-run-admission",
        "Persist And List Run Admission",
        PRIMARY_SURFACES,
        "Persist admission, reload it in daemon requests, and display it through the CLI.",
      ),
      "utf8",
    );
    return;
  }
  writeFileSync(
    join(stage, "persist-run-admission.md"),
    intent(
      "persist-run-admission",
      "Persist Run Admission",
      [PRIMARY_SURFACES[0]],
      "Store admitted workflow runs durably before dispatch.",
    ),
    "utf8",
  );
  writeFileSync(
    join(stage, "reload-admitted-runs.md"),
    intent(
      "reload-admitted-runs",
      "Reload Admitted Runs",
      [PRIMARY_SURFACES[1]],
      "Reload stored run admission while handling daemon requests after restart.",
      "- Durable run admission exists.",
    ),
    "utf8",
  );
  writeFileSync(
    join(stage, "list-persisted-run-admission.md"),
    intent(
      "list-persisted-run-admission",
      "List Persisted Run Admission",
      [PRIMARY_SURFACES[2]],
      "Display persisted admission state in the run-list command.",
      "- Durable run admission exists.\n- Daemon requests reload admitted runs after restart.",
    ),
    "utf8",
  );
}

function writeSingleSurfaceStage(stage: string, revised: boolean): void {
  writeFileSync(
    join(stage, "settle-exhausted-write-attempts.md"),
    intent(
      "settle-exhausted-write-attempts",
      "Settle Exhausted Write Attempts",
      [EXECUTION_LOOP_SURFACE],
      [
        "Record the final attempt reason, classify exhausted retries, and return the terminal result.",
        ...(revised ? ["Unsplit rationale: All concerns belong to the execution-loop implementation boundary."] : []),
      ].join("\n"),
    ),
    "utf8",
  );
}

function classifyRenderedSeed(prompt: string): "multi-surface" | "single-surface" {
  const begin = "<<<SEED_BEGIN>>>\n";
  const end = "<<<SEED_END>>>";
  const beginIndex = prompt.indexOf(begin);
  const endIndex = prompt.indexOf(end, beginIndex + begin.length);
  if (
    beginIndex === -1 ||
    endIndex === -1 ||
    prompt.indexOf(begin, beginIndex + begin.length) !== -1 ||
    prompt.indexOf(end, endIndex + end.length) !== -1
  )
    throw new Error("stub rejected missing or malformed rendered seed delimiters");
  const renderedSeed = prompt.slice(beginIndex + begin.length, endIndex);
  if (!renderedSeed.endsWith("\n")) throw new Error("stub rejected malformed rendered seed content");
  const seed = renderedSeed.slice(0, -1);
  if (seed === MULTI_SURFACE_SEED_CONTENT) return "multi-surface";
  if (seed === SINGLE_SURFACE_SEED_CONTENT) return "single-surface";
  throw new Error("stub rejected missing or altered rendered seed content");
}

function splitterBinding(contractProjection?: (prompt: string) => string): InvocationBinding {
  return {
    id: "intent-split-stub",
    invoke: async ({ prompt, cwd }) => {
      const projectedPrompt = contractProjection?.(prompt) ?? prompt;
      const stage = join(cwd, ".jarvis-intent-stage");
      const revised = hasSurfaceContract(projectedPrompt);
      if (classifyRenderedSeed(prompt) === "multi-surface") {
        writeMultiSurfaceStage(stage, revised);
      } else {
        writeSingleSurfaceStage(stage, revised);
      }
      return { kind: "ok", stdout: "done", stderr: "" };
    },
  };
}

function preChangeContract(prompt: string): string {
  return normalize(prompt)
    .replace(INTENT_SPLIT_SURFACE_PIN, "one terse behavior-level intent per independently observable slice")
    .replace(
      SINGLE_SURFACE_PIN,
      "if the seed is already one independently observable behavior, emit exactly one intent",
    );
}

async function executeSeed(
  seedPath: string,
  contractProjection?: (prompt: string) => string,
): Promise<{ resultKind: string; stage: string }> {
  const { jarvisRoot } = createJarvisHome();
  roots.push(join(jarvisRoot, ".."));
  mkdirSync(jarvisRoot, { recursive: true });
  const configPath = join(jarvisRoot, "config.json");
  writeFileSync(configPath, JSON.stringify({ projects: { demo: { root: REPO_ROOT, git: false } } }), "utf8");
  const built = await buildIntentWorkflowSteps(
    {
      cwd: REPO_ROOT,
      seed: relative(REPO_ROOT, seedPath),
      configPath,
      jarvisRoot,
      reviewPasses: 0,
    },
    { resolveProjectMatch: () => ({ key: "demo", root: REPO_ROOT }), loadWorkflowSteps: load },
  );
  if (!built.ok) throw new Error(built.error);
  const step = built.steps[0];
  if (step?.behavior !== "write") throw new Error("expected built intent write step");
  const result = await executeWrite({
    worktree: step.worktree,
    specPath: step.specPath,
    stepRules: step.stepRules,
    expectedArtifactPath: step.expectedArtifactPath,
    bindings: [splitterBinding(contractProjection)],
    withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
    ...(step.promptId !== undefined ? { promptId: step.promptId } : {}),
    ...(step.promptPlaceholders !== undefined ? { promptPlaceholders: step.promptPlaceholders } : {}),
  });
  return {
    resultKind: result.result.kind,
    stage: join(result.worktreePath, step.expectedArtifactPath),
  };
}

function validStagedIntentContents(stage: string): string[] {
  const filenames = validateIntentFilenames(listIntentStageMarkdownFiles(stage));
  if (!filenames.ok) throw new Error(filenames.error);
  const contentValidation = validateIntentStageContent(filenames.intents);
  if (!contentValidation.ok) throw new Error(contentValidation.error);
  return filenames.intents.map(({ path }) => readFileSync(path, "utf8"));
}

function primarySurface(content: string): string {
  const marker = "## Primary implementation surface";
  const markerIndex = content.indexOf(marker);
  const afterMarker = markerIndex === -1 ? "" : content.slice(markerIndex + marker.length);
  const nextSection = afterMarker.indexOf("\n## ");
  const section = nextSection === -1 ? afterMarker : afterMarker.slice(0, nextSection);
  const owners = section
    .trim()
    .split("\n")
    .filter((line) => line.trim().length > 0);
  if (owners.length !== 1) throw new Error(`expected exactly one primary implementation surface, got ${owners.length}`);
  return owners[0] ?? "";
}

function prerequisites(content: string): string[] {
  const marker = "## Prerequisites";
  const markerIndex = content.indexOf(marker);
  if (markerIndex === -1) throw new Error("expected prerequisites section");
  const afterMarker = content.slice(markerIndex + marker.length);
  const nextSection = afterMarker.indexOf("\n## ");
  const section = nextSection === -1 ? afterMarker : afterMarker.slice(0, nextSection);
  return section
    .trim()
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2));
}

function assertMultiSurfaceStage(stage: string): void {
  const intents = validStagedIntentContents(stage);
  const owners = intents.map(primarySurface);
  if (intents.length !== PRIMARY_SURFACES.length)
    throw new Error(`expected ${PRIMARY_SURFACES.length} surface intents, got ${intents.length}`);
  if (new Set(owners).size !== owners.length) throw new Error("primary implementation surfaces must be distinct");
  for (const owner of PRIMARY_SURFACES)
    if (!owners.includes(owner)) throw new Error(`missing primary implementation surface ${owner}`);
  const intentBySurface = new Map(intents.map((content) => [primarySurface(content), content]));
  const daemon = intentBySurface.get(PRIMARY_SURFACES[1]);
  const cli = intentBySurface.get(PRIMARY_SURFACES[2]);
  if (daemon === undefined || !prerequisites(daemon).includes(PERSISTENCE_BEHAVIOR))
    throw new Error("daemon intent must depend on persistence");
  if (
    cli === undefined ||
    !prerequisites(cli).includes(PERSISTENCE_BEHAVIOR) ||
    !prerequisites(cli).includes(DAEMON_BEHAVIOR)
  )
    throw new Error("CLI intent must depend on persistence and daemon");
}

function assertSingleSurfaceStage(stage: string): void {
  const intents = validStagedIntentContents(stage);
  if (intents.length !== 1) throw new Error(`expected one single-surface intent, got ${intents.length}`);
  const content = intents[0] ?? "";
  if (primarySurface(content) !== EXECUTION_LOOP_SURFACE)
    throw new Error(`expected primary implementation surface ${EXECUTION_LOOP_SURFACE}`);
  const rationaleLines = content.split("\n").filter((line) => line.startsWith("Unsplit rationale:"));
  if (rationaleLines.length !== 1 || rationaleLines[0]?.slice("Unsplit rationale:".length).trim().length === 0)
    throw new Error("expected one non-empty one-line unsplit rationale");
}

describe("intent split production write regression", () => {
  test("multi-surface seed fans out by surface through the production split write", async () => {
    const result = await executeSeed(MULTI_SURFACE_SEED);

    expect(result.resultKind).toBe("complete");
    expect(() => assertMultiSurfaceStage(result.stage)).not.toThrow();
  });

  test("single-surface seed stays whole through the production split write", async () => {
    const result = await executeSeed(SINGLE_SURFACE_SEED);

    expect(result.resultKind).toBe("complete");
    expect(() => assertSingleSurfaceStage(result.stage)).not.toThrow();
  });

  test("pre-change contract fails both staging oracles", async () => {
    const multi = await executeSeed(MULTI_SURFACE_SEED, preChangeContract);
    const single = await executeSeed(SINGLE_SURFACE_SEED, preChangeContract);

    expect(multi.resultKind).toBe("complete");
    expect(single.resultKind).toBe("complete");
    expect(() => assertMultiSurfaceStage(multi.stage)).toThrow(
      "expected exactly one primary implementation surface, got 3",
    );
    expect(() => assertSingleSurfaceStage(single.stage)).toThrow("expected one non-empty one-line unsplit rationale");
  });
});
