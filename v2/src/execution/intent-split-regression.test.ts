import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  listIntentStageMarkdownFiles,
  validateIntentFilenames,
  validateIntentStageContent,
} from "../../../shared/intent-stage.ts";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import {
  classifyModuleBoundaryText,
  MODULE_BOUNDARY_SURFACES,
  type ModuleBoundarySurface,
  orderModuleBoundariesForSplit,
  referencedArtifactPaths,
} from "../../../shared/module-boundary-surfaces.ts";
import {
  buildIntentSplitPrompt,
  INTENT_SPLIT_DECLARATION_PIN,
  INTENT_SPLIT_SURFACE_PIN,
} from "../../../shared/prompts/intent-split.ts";
import { StructuralTestLocatorError } from "../../../shared/structural-test-locator.ts";
import { createFakeWithExternalWorktree, createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
import { buildIntentWorkflowSteps } from "./publication-workflow-steps.ts";
import type { LoadedWorkflowStep, WorkflowSourceStep } from "./workflow-loader.ts";
import { executeWrite } from "./write.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const INTENT_SPLIT_FIXTURE_DIR = join(import.meta.dir, "fixtures");
const INTENT_SPLIT_FIXTURES = {
  multiSurface: "intent-split-multi-surface.md",
  singleSurface: "intent-split-single-surface.md",
} as const;
const MULTI_SURFACE_SEED = join(INTENT_SPLIT_FIXTURE_DIR, INTENT_SPLIT_FIXTURES.multiSurface);
const SINGLE_SURFACE_SEED = join(INTENT_SPLIT_FIXTURE_DIR, INTENT_SPLIT_FIXTURES.singleSurface);
const SINGLE_SURFACE_PIN =
  "if the seed touches exactly one module-boundary surface, emit exactly one intent, and state in one line in that intent's body why splitting does not apply";
const PERSISTENCE_BEHAVIOR = "Durable run admission exists.";
const DAEMON_BEHAVIOR = "Daemon requests reload admitted runs after restart.";

function readIntentSplitFixture(fixtureId: string): string {
  try {
    return readFileSync(join(INTENT_SPLIT_FIXTURE_DIR, fixtureId), "utf8");
  } catch {
    throw new StructuralTestLocatorError("discovered-file", fixtureId);
  }
}

function seedLinePaths(line: string): readonly string[] {
  const artifactPaths = referencedArtifactPaths(line);
  if (artifactPaths.length > 0) return artifactPaths;
  const directoryPaths: string[] = [];
  for (const match of line.matchAll(/`([^`\s]*\/[^`\s]*\/)`/gu)) {
    const path = match[1];
    if (path !== undefined) directoryPaths.push(path);
  }
  return directoryPaths;
}

function seedPrimaryImplementationSurfaces(seedContent: string): readonly string[] {
  const pathBySurface = new Map<ModuleBoundarySurface, string>();
  for (const line of seedContent.split("\n")) {
    const paths = seedLinePaths(line);
    if (paths.length !== 1) continue;
    const path = paths[0];
    if (path === undefined) continue;
    for (const surface of classifyModuleBoundaryText(line)) {
      if (!pathBySurface.has(surface)) pathBySurface.set(surface, path);
    }
  }
  if (pathBySurface.size >= 2) {
    const ordered = orderModuleBoundariesForSplit(
      seedContent,
      MODULE_BOUNDARY_SURFACES.filter((surface) => pathBySurface.has(surface)),
    );
    return ordered.map((surface) => {
      const path = pathBySurface.get(surface);
      if (path === undefined) throw new Error(`seed missing primary implementation surface path for ${surface}`);
      return path;
    });
  }
  const paths = seedContent
    .split("\n")
    .flatMap((line) => seedLinePaths(line))
    .filter((path, index, all) => all.indexOf(path) === index);
  if (paths.length !== 1) {
    throw new Error(`expected exactly one primary implementation surface path in seed, got ${paths.length}`);
  }
  return paths;
}

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
  return (
    normalized.includes(INTENT_SPLIT_SURFACE_PIN) &&
    normalized.includes(SINGLE_SURFACE_PIN) &&
    normalized.includes(INTENT_SPLIT_DECLARATION_PIN.toLowerCase())
  );
}

function intent(
  name: string,
  title: string,
  primarySurfaces: readonly string[],
  body: string,
  prerequisites = "",
): string {
  const primarySurfaceSection =
    primarySurfaces.length === 0
      ? ""
      : `

## Primary implementation surface

${primarySurfaces.join("\n")}`;
  return `---
name: ${name}
---

# ${title}

${body}${primarySurfaceSection}

## Prerequisites

${prerequisites}`;
}

function writeMultiSurfaceStage(stage: string, revised: boolean, seedContent: string): void {
  const expectedSurfaces = seedPrimaryImplementationSurfaces(seedContent);
  if (!revised) {
    writeFileSync(
      join(stage, "persist-and-list-run-admission.md"),
      intent(
        "persist-and-list-run-admission",
        "Persist And List Run Admission",
        expectedSurfaces,
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
      [expectedSurfaces[0] ?? ""],
      "Store admitted workflow runs durably before dispatch.",
    ),
    "utf8",
  );
  writeFileSync(
    join(stage, "reload-admitted-runs.md"),
    intent(
      "reload-admitted-runs",
      "Reload Admitted Runs",
      [expectedSurfaces[1] ?? ""],
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
      [expectedSurfaces[2] ?? ""],
      "Display persisted admission state in the run-list command.",
      "- Durable run admission exists.\n- Daemon requests reload admitted runs after restart.",
    ),
    "utf8",
  );
}

function writeSingleSurfaceStage(stage: string, revised: boolean, seedContent: string): void {
  const expectedSurface = seedPrimaryImplementationSurfaces(seedContent)[0] ?? "";
  writeFileSync(
    join(stage, "settle-exhausted-write-attempts.md"),
    intent(
      "settle-exhausted-write-attempts",
      "Settle Exhausted Write Attempts",
      revised ? [expectedSurface] : [],
      [
        "Record the final attempt reason, classify exhausted retries, and return the terminal result.",
        ...(revised ? ["Unsplit rationale: All concerns belong to the execution-loop implementation boundary."] : []),
      ].join("\n"),
    ),
    "utf8",
  );
}

function classifyRenderedSeed(prompt: string): { kind: "multi-surface" | "single-surface"; content: string } {
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
  const multiSurfaceContent = readIntentSplitFixture(INTENT_SPLIT_FIXTURES.multiSurface);
  const singleSurfaceContent = readIntentSplitFixture(INTENT_SPLIT_FIXTURES.singleSurface);
  if (seed === multiSurfaceContent) return { kind: "multi-surface", content: multiSurfaceContent };
  if (seed === singleSurfaceContent) return { kind: "single-surface", content: singleSurfaceContent };
  throw new Error("stub rejected missing or altered rendered seed content");
}

function splitterBinding(contractProjection?: (prompt: string) => string): InvocationBinding {
  return {
    id: "intent-split-stub",
    invoke: async ({ prompt, cwd }) => {
      const projectedPrompt = contractProjection?.(prompt) ?? prompt;
      const stage = join(cwd, ".jarvis-intent-stage");
      const revised = hasSurfaceContract(projectedPrompt);
      const renderedSeed = classifyRenderedSeed(prompt);
      if (renderedSeed.kind === "multi-surface") {
        writeMultiSurfaceStage(stage, revised, renderedSeed.content);
      } else {
        writeSingleSurfaceStage(stage, revised, renderedSeed.content);
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
    )
    .replace(INTENT_SPLIT_DECLARATION_PIN.toLowerCase(), "");
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

function assertMultiSurfaceStage(stage: string, seedContent: string): void {
  const expectedSurfaces = seedPrimaryImplementationSurfaces(seedContent);
  const intents = validStagedIntentContents(stage);
  const owners = intents.map(primarySurface);
  if (intents.length !== expectedSurfaces.length)
    throw new Error(`expected ${expectedSurfaces.length} surface intents, got ${intents.length}`);
  if (new Set(owners).size !== owners.length) throw new Error("primary implementation surfaces must be distinct");
  for (const owner of expectedSurfaces)
    if (!owners.includes(owner)) throw new Error(`missing primary implementation surface ${owner}`);
  const intentBySurface = new Map(intents.map((content) => [primarySurface(content), content]));
  const daemonSurface = expectedSurfaces[1];
  const cliSurface = expectedSurfaces[2];
  if (daemonSurface === undefined || cliSurface === undefined) {
    throw new Error(`expected at least three primary implementation surfaces, got ${expectedSurfaces.length}`);
  }
  const daemon = intentBySurface.get(daemonSurface);
  const cli = intentBySurface.get(cliSurface);
  if (daemon === undefined || !prerequisites(daemon).includes(PERSISTENCE_BEHAVIOR))
    throw new Error("daemon intent must depend on persistence");
  if (
    cli === undefined ||
    !prerequisites(cli).includes(PERSISTENCE_BEHAVIOR) ||
    !prerequisites(cli).includes(DAEMON_BEHAVIOR)
  )
    throw new Error("CLI intent must depend on persistence and daemon");
}

function assertSingleSurfaceStage(stage: string, seedContent: string): void {
  const expectedSurface = seedPrimaryImplementationSurfaces(seedContent)[0] ?? "";
  const intents = validStagedIntentContents(stage);
  if (intents.length !== 1) throw new Error(`expected one single-surface intent, got ${intents.length}`);
  const content = intents[0] ?? "";
  if (primarySurface(content) !== expectedSurface)
    throw new Error(`expected primary implementation surface ${expectedSurface}`);
  const rationaleLines = content.split("\n").filter((line) => line.startsWith("Unsplit rationale:"));
  if (rationaleLines.length !== 1 || rationaleLines[0]?.slice("Unsplit rationale:".length).trim().length === 0)
    throw new Error("expected one non-empty one-line unsplit rationale");
}

describe("intent split production write regression", () => {
  test("the split contract requires the single-surface declaration pair", () => {
    const prompt = buildIntentSplitPrompt({
      workdir: "/tmp/worktree",
      seedLabel: "inline",
      seedContent: "Split reporting",
      stagingDir: ".jarvis-intent-stage",
    });

    expect(normalize(prompt)).toContain(INTENT_SPLIT_DECLARATION_PIN.toLowerCase());
  });

  test("multi-surface seed fans out by surface through the production split write", async () => {
    const seedContent = readIntentSplitFixture(INTENT_SPLIT_FIXTURES.multiSurface);
    const result = await executeSeed(MULTI_SURFACE_SEED);

    expect(result.resultKind).toBe("complete");
    expect(() => assertMultiSurfaceStage(result.stage, seedContent)).not.toThrow();
  });

  test("single-surface seed stays whole through the production split write", async () => {
    // @mutate prompts/intent/split.md "- Write that line as an `Unsplit rationale:` line, and give that intent a `## Primary implementation surface` section naming exactly one entry." -> ""
    const seedContent = readIntentSplitFixture(INTENT_SPLIT_FIXTURES.singleSurface);
    const result = await executeSeed(SINGLE_SURFACE_SEED);

    expect(result.resultKind).toBe("complete");
    expect(() => assertSingleSurfaceStage(result.stage, seedContent)).not.toThrow();
  });

  test("pre-change contract fails both staging oracles", async () => {
    const multiSeedContent = readIntentSplitFixture(INTENT_SPLIT_FIXTURES.multiSurface);
    const singleSeedContent = readIntentSplitFixture(INTENT_SPLIT_FIXTURES.singleSurface);
    const multi = await executeSeed(MULTI_SURFACE_SEED, preChangeContract);
    const single = await executeSeed(SINGLE_SURFACE_SEED, preChangeContract);

    expect(multi.resultKind).toBe("complete");
    expect(single.resultKind).toBe("complete");
    expect(() => assertMultiSurfaceStage(multi.stage, multiSeedContent)).toThrow(
      "expected exactly one primary implementation surface, got 3",
    );
    expect(() => assertSingleSurfaceStage(single.stage, singleSeedContent)).toThrow(
      "expected exactly one primary implementation surface, got 0",
    );
  });
});
