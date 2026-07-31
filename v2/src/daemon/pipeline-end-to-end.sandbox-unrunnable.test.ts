import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import { buildImplementWorkflowSteps } from "../execution/implement-workflow-steps.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import { getPipelineDefinition } from "../execution/pipeline-registry.ts";
import { resolveProjectPipeline } from "../execution/project-pipeline-resolution.ts";
import { loadWorkflowSteps } from "../execution/workflow-loader.ts";
import { WORKFLOW_PRESET_BUILDERS } from "../execution/workflow-presets.ts";
import {
  openStateStore,
  type Pipeline,
  type PipelineStageRecord,
  type StateStore,
} from "../persistence/state-store.ts";
import { flushBackgroundRuns } from "../testing/run-control.ts";
import { createFakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers } from "./daemon.ts";
import { derivePipelineState, setInvertResumeFailedRequiresReopenForTest } from "./pipeline-execution.ts";
import type { PipelineWorkflowDispatch, PipelineWorkflowWait } from "./pipeline-stage-dispatch.ts";
import {
  createChainedStageProjectMatch,
  resolveStageWorkflowSteps,
  setCollapseFanOutToFirstInputForTest,
  setInvertPriorWorktreeRootGuardForTest,
} from "./pipeline-stage-resolve.ts";

const PROJECT_KEY = "demo";
const STAGE_IDS = ["intent", "approve-intent", "plan", "approve-plan", "implement"] as const;
const FAST_STAGE_IDS = ["intent", "plan", "implement"] as const;
const READY_INTENTS_DIR = "v2/spec/ready-intents";
const INTENT_SPEC = `${READY_INTENTS_DIR}/ship-feature.md`;
const PLAN_SPEC = "v2/spec/ship-feature/index.md";
const PLAN_WORK_SPEC = "v2/spec/ship-feature/00-work.md";
const FAN_OUT_BRANCH_KEYS = ["alpha", "beta"] as const;
const INTENT_ALPHA = `${READY_INTENTS_DIR}/alpha.md`;
const INTENT_BETA = `${READY_INTENTS_DIR}/beta.md`;
const PLAN_ALPHA_SPEC = "v2/spec/alpha/index.md";
const PLAN_BETA_SPEC = "v2/spec/beta/index.md";
const TERMINAL_PR = { prNumber: 42, prUrl: "https://github.com/org/repo/pull/42" } as const;
const FAST_SUBPROCESS_RUNNER: AsyncSubprocessRunner = {
  runAsync: async () => "",
};

let _sandboxRepoRoot = "";
let resolveStageMachinesDir = "";

function loadStepsWithProfile(steps: Parameters<typeof loadWorkflowSteps>[0]) {
  return loadWorkflowSteps(steps, { machineProfile: "home", machinesDir: resolveStageMachinesDir });
}

// `resolveStageWorkflowSteps` widens every preset input to `BuildImplementWorkflowStepsInput`
// before dispatch, so the map's declared signature is looser than each builder's real input.

function fastProductionResolveStage(
  definition: PipelineDefinition,
  stageIndex: number,
  context: Parameters<typeof resolveStageWorkflowSteps>[2],
  stageArtifacts: Parameters<typeof resolveStageWorkflowSteps>[3],
  deps: Parameters<typeof resolveStageWorkflowSteps>[4] = {},
) {
  const builders = {
    ...WORKFLOW_PRESET_BUILDERS,
    implement: (input: Parameters<typeof buildImplementWorkflowSteps>[0]) =>
      buildImplementWorkflowSteps(
        {
          ...input,
          reviewPasses: input.reviewPasses ?? 1,
          reviewBehavior: input.reviewBehavior ?? "light",
          preflightGitRoot: input.preflightGitRoot ?? input.cwd,
          projectRoot: input.projectRoot ?? context.cwd,
          projectName: input.projectName ?? PROJECT_KEY,
          ...(context.configPath !== undefined ? { configPath: context.configPath } : {}),
        },
        {
          asyncSubprocessRunner: FAST_SUBPROCESS_RUNNER,
          readSpecFile: (path) => readFileSync(path, "utf8"),
          resolveProjectMatch: createChainedStageProjectMatch(context),
          loadWorkflowSteps: loadStepsWithProfile,
        },
      ),
  };
  return resolveStageWorkflowSteps(definition, stageIndex, context, stageArtifacts, {
    builders: builders as unknown as typeof WORKFLOW_PRESET_BUILDERS,
    ...deps,
  });
}

const ALL_REVIEW_ROLES_CONFIG: AgentModelConfig = {
  claude: {
    critic: { rungs: [{ adapterModel: "critic", priceKey: "critic" }] },
    actuator: { rungs: [{ adapterModel: "actuator", priceKey: "actuator" }] },
    adversary: { rungs: [{ adapterModel: "adversary", priceKey: "adversary" }] },
    advocate: { rungs: [{ adapterModel: "advocate", priceKey: "advocate" }] },
    adjudicator: { rungs: [{ adapterModel: "adjudicator", priceKey: "adjudicator" }] },
    implement: { rungs: [{ adapterModel: "implement", priceKey: "implement" }] },
    plan: { rungs: [{ adapterModel: "plan", priceKey: "plan" }] },
    shrink: { rungs: [{ adapterModel: "shrink", priceKey: "shrink" }] },
  },
};

function requestFrame(id: string, method: string, params?: unknown) {
  return { kind: "request" as const, id, method, params };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
  debugLabel?: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate()) && Date.now() < deadline) {
    await flushBackgroundRuns(10);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!(await predicate())) {
    const detail = debugLabel ?? "waitFor";
    throw new Error(`${detail} timed out`);
  }
}

type LoadedPipeline = Pipeline & { stages: PipelineStageRecord[] };

function stageStatusVector(pipeline: LoadedPipeline): string[] {
  return STAGE_IDS.map((stageId) => pipeline.stages.find((stage) => stage.stageId === stageId)?.status ?? "missing");
}

function setupPipelineSandboxRepo(roots: string[]): { repoRoot: string; jarvisRoot: string } {
  const root = mkdtempSync(join(tmpdir(), "jarvis-v2-worktree-"));
  roots.push(root);
  const repoRoot = join(root, "repo");
  const jarvisRoot = join(root, "jarvis-home");

  mkdirSync(join(repoRoot, "v2/spec/ready-intents"), { recursive: true });
  mkdirSync(join(repoRoot, "v2/spec/ship-feature"), { recursive: true });
  writeFileSync(join(repoRoot, "README.md"), "seed\n", "utf8");
  writeFileSync(join(repoRoot, "seed.md"), "Ship feature\n", "utf8");
  writeFileSync(
    join(repoRoot, INTENT_SPEC),
    "---\nname: ship-feature\n---\n\n## Prerequisites\n\nnone\n\n## Acceptance criteria\n\n- [ ] pending\n",
    "utf8",
  );
  writeFileSync(join(repoRoot, PLAN_SPEC), "# ship-feature\n\n- [ ] [Work](./00-work.md)\n", "utf8");
  writeFileSync(join(repoRoot, PLAN_WORK_SPEC), "# Work\n\n## Acceptance criteria\n\n- [ ] Work\n", "utf8");

  execFileSync("git", ["init", repoRoot], { stdio: "pipe" });
  execFileSync("git", ["-C", repoRoot, "config", "user.email", "test@example.com"], { stdio: "pipe" });
  execFileSync("git", ["-C", repoRoot, "config", "user.name", "Test User"], { stdio: "pipe" });
  execFileSync("git", ["-C", repoRoot, "add", "-A"], { stdio: "pipe" });
  execFileSync("git", ["-C", repoRoot, "commit", "-m", "seed"], { stdio: "pipe" });

  return { repoRoot, jarvisRoot };
}

function setupFastPipelineSandboxRepo(roots: string[]): {
  repoRoot: string;
  jarvisRoot: string;
  artifactTemplatesDir: string;
} {
  const root = mkdtempSync(join(tmpdir(), "jarvis-v2-fast-worktree-"));
  roots.push(root);
  const repoRoot = join(root, "repo");
  const jarvisRoot = join(root, "jarvis-home");
  const artifactTemplatesDir = join(root, "artifact-templates");

  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(join(artifactTemplatesDir, dirname(INTENT_SPEC)), { recursive: true });
  mkdirSync(join(artifactTemplatesDir, dirname(PLAN_SPEC)), { recursive: true });
  mkdirSync(join(artifactTemplatesDir, dirname(PLAN_WORK_SPEC)), { recursive: true });
  writeFileSync(join(repoRoot, "README.md"), "seed\n", "utf8");
  writeFileSync(
    join(artifactTemplatesDir, INTENT_SPEC),
    "---\nname: ship-feature\n---\n\n## Prerequisites\n\nnone\n\n## Acceptance criteria\n\n- [ ] pending\n",
    "utf8",
  );
  writeFileSync(join(artifactTemplatesDir, PLAN_SPEC), "# ship-feature\n\n- [ ] [Work](./00-work.md)\n", "utf8");
  writeFileSync(join(artifactTemplatesDir, PLAN_WORK_SPEC), "# Work\n\n## Acceptance criteria\n\n- [ ] Work\n", "utf8");

  execFileSync("git", ["init", repoRoot], { stdio: "pipe" });
  execFileSync("git", ["-C", repoRoot, "config", "user.email", "test@example.com"], { stdio: "pipe" });
  execFileSync("git", ["-C", repoRoot, "config", "user.name", "Test User"], { stdio: "pipe" });
  execFileSync("git", ["-C", repoRoot, "add", "-A"], { stdio: "pipe" });
  execFileSync("git", ["-C", repoRoot, "commit", "-m", "seed"], { stdio: "pipe" });

  return { repoRoot, jarvisRoot, artifactTemplatesDir };
}

function readyIntentContent(name: string): string {
  return `---\nname: ${name}\n---\n\n## Prerequisites\n\nnone\n\n## Acceptance criteria\n\n- [ ] pending\n`;
}

function planIndexContent(name: string, workRel: string): string {
  return `# ${name}\n\n- [ ] [Work](${workRel})\n`;
}

function setupFastTwoBranchPipelineSandboxRepo(roots: string[]): {
  repoRoot: string;
  jarvisRoot: string;
  artifactTemplatesDir: string;
} {
  const root = mkdtempSync(join(tmpdir(), "jarvis-v2-fast-fan-out-"));
  roots.push(root);
  const repoRoot = join(root, "repo");
  const jarvisRoot = join(root, "jarvis-home");
  const artifactTemplatesDir = join(root, "artifact-templates");

  mkdirSync(repoRoot, { recursive: true });
  writeFileSync(join(repoRoot, "README.md"), "seed\n", "utf8");
  for (const branchKey of FAN_OUT_BRANCH_KEYS) {
    const intentPath = join(artifactTemplatesDir, READY_INTENTS_DIR, `${branchKey}.md`);
    const planDir = join(artifactTemplatesDir, "v2/spec", branchKey);
    mkdirSync(dirname(intentPath), { recursive: true });
    mkdirSync(planDir, { recursive: true });
    writeFileSync(intentPath, readyIntentContent(branchKey), "utf8");
    writeFileSync(join(planDir, "index.md"), planIndexContent(branchKey, "./00-work.md"), "utf8");
    writeFileSync(join(planDir, "00-work.md"), "# Work\n\n## Acceptance criteria\n\n- [ ] Work\n", "utf8");
  }

  execFileSync("git", ["init", repoRoot], { stdio: "pipe" });
  execFileSync("git", ["-C", repoRoot, "config", "user.email", "test@example.com"], { stdio: "pipe" });
  execFileSync("git", ["-C", repoRoot, "config", "user.name", "Test User"], { stdio: "pipe" });
  execFileSync("git", ["-C", repoRoot, "add", "-A"], { stdio: "pipe" });
  execFileSync("git", ["-C", repoRoot, "commit", "-m", "seed"], { stdio: "pipe" });

  return { repoRoot, jarvisRoot, artifactTemplatesDir };
}

function branchPlanSpecs(branchKey: string): { planSpec: string; planWorkSpec: string } {
  return {
    planSpec: `v2/spec/${branchKey}/index.md`,
    planWorkSpec: `v2/spec/${branchKey}/00-work.md`,
  };
}

function branchReadyIntentSpec(branchKey: string): string {
  return `${READY_INTENTS_DIR}/${branchKey}.md`;
}

function seedGitWorktreeArtifacts(
  repoRoot: string,
  branch: string,
  files: ReadonlyArray<{ specPath: string; content: string }>,
): string {
  const worktreePath = join(repoRoot, ".jarvis-worktrees", branch);
  try {
    execFileSync("git", ["rev-parse", "--verify", branch], { cwd: repoRoot, stdio: "ignore" });
    try {
      execFileSync("git", ["worktree", "add", worktreePath, branch], { cwd: repoRoot, stdio: "pipe" });
    } catch {
      // worktree already checked out for this branch
    }
  } catch {
    execFileSync("git", ["branch", branch], { cwd: repoRoot, stdio: "pipe" });
    execFileSync("git", ["worktree", "add", worktreePath, branch], { cwd: repoRoot, stdio: "pipe" });
  }
  for (const { specPath, content } of files) {
    const targetPath = join(worktreePath, specPath);
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, "utf8");
  }
  execFileSync("git", ["add", "-A"], { cwd: worktreePath, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", `seed ${branch}`], { cwd: worktreePath, stdio: "pipe" });
  return worktreePath;
}

function writeMachineProfile(jarvisRoot: string): void {
  const machinesDir = join(jarvisRoot, "machines");
  mkdirSync(machinesDir, { recursive: true });
  writeFileSync(
    join(machinesDir, "home.json"),
    JSON.stringify({
      models: {
        claude: Object.fromEntries(
          Object.keys(ALL_REVIEW_ROLES_CONFIG.claude ?? {}).map((role) => [
            role,
            { rungs: [{ adapterModel: role, priceKey: role }] },
          ]),
        ),
      },
    }),
  );
}

type FakeInvocationOptions = {
  dispatchSequence?: readonly string[];
  failFirstPlanWait?: boolean;
  artifactRoot?: string;
  gitWorktrees?: boolean;
  extraPlanArtifacts?: readonly string[];
  twoBranchFanOut?: boolean;
  branchKeys?: readonly string[];
};

function createFakePipelineInvocation(
  store: StateStore,
  repoRoot: string,
  options: FakeInvocationOptions = {},
): {
  dispatch: PipelineWorkflowDispatch;
  wait: PipelineWorkflowWait;
  dispatchCounts: Record<string, number>;
  firstPlanRunId: () => string | undefined;
} {
  const dispatchCounts: Record<string, number> = { intent: 0, plan: 0, implement: 0 };
  const branchKeys = options.branchKeys ?? [...FAN_OUT_BRANCH_KEYS];
  const twoBranchFanOut = options.twoBranchFanOut ?? false;
  const defaultSequence = twoBranchFanOut
    ? ["intent", "plan", "plan", "implement", "implement"]
    : ["intent", "plan", "plan", "implement"];
  const dispatchSequence = options.dispatchSequence ?? defaultSequence;
  const artifactRoot = options.artifactRoot ?? repoRoot;
  let dispatchIndex = 0;
  let firstPlanRunId: string | undefined;

  const branchKeyForDispatch = (stageId: string): string | undefined => {
    if (!twoBranchFanOut || stageId === "intent") return undefined;
    const ordinal = (dispatchCounts[stageId] ?? 0) + 1;
    return branchKeys[ordinal - 1];
  };

  const branchForStage = (stageId: string, branchKey?: string): string => {
    if (stageId === "intent") return twoBranchFanOut ? "intent/fan-out" : "intent/ship-feature";
    if (stageId === "plan") {
      return twoBranchFanOut ? `plan/${branchKey ?? "ship-feature"}` : "plan/ship-feature";
    }
    return twoBranchFanOut ? `implement/${branchKey ?? "ship-feature"}` : "implement/ship-feature";
  };

  const specForStage = (stageId: string, branchKey?: string): string => {
    if (stageId === "intent") return twoBranchFanOut ? READY_INTENTS_DIR : INTENT_SPEC;
    if (twoBranchFanOut && branchKey !== undefined) return branchPlanSpecs(branchKey).planSpec;
    return PLAN_SPEC;
  };

  const artifactFilesForStage = (
    stageId: string,
    branchKey?: string,
  ): ReadonlyArray<{ specPath: string; content: string }> => {
    if (stageId === "intent" && twoBranchFanOut) {
      return branchKeys.map((key) => {
        const specPath = branchReadyIntentSpec(key);
        return { specPath, content: readFileSync(join(artifactRoot, specPath), "utf8") };
      });
    }
    if (stageId === "plan") {
      const extra =
        twoBranchFanOut && branchKey !== undefined
          ? [branchPlanSpecs(branchKey).planWorkSpec]
          : (options.extraPlanArtifacts ?? []);
      return [specForStage(stageId, branchKey), ...extra].map((specPath) => ({
        specPath,
        content: readFileSync(join(artifactRoot, specPath), "utf8"),
      }));
    }
    const specPath = specForStage(stageId, branchKey);
    return [{ specPath, content: readFileSync(join(artifactRoot, specPath), "utf8") }];
  };

  const seedWorktreeArtifact = (worktreePath: string, specPath: string): void => {
    const targetPath = join(worktreePath, specPath);
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, readFileSync(join(artifactRoot, specPath), "utf8"), "utf8");
  };

  const dispatch: PipelineWorkflowDispatch = async () => {
    const stageId = dispatchSequence[dispatchIndex];
    if (stageId === undefined) throw new Error("unexpected pipeline dispatch");
    dispatchIndex += 1;
    const branchKey = branchKeyForDispatch(stageId);
    dispatchCounts[stageId] = (dispatchCounts[stageId] ?? 0) + 1;
    const branch = branchForStage(stageId, branchKey);
    const specPath = specForStage(stageId, branchKey);
    const worktreePath = options.gitWorktrees
      ? seedGitWorktreeArtifacts(repoRoot, branch, artifactFilesForStage(stageId, branchKey))
      : (() => {
          const path = join(repoRoot, ".jarvis-worktrees", branch);
          for (const file of artifactFilesForStage(stageId, branchKey)) {
            seedWorktreeArtifact(path, file.specPath);
          }
          return path;
        })();
    const runId = store.createRun({
      project: PROJECT_KEY,
      specRef: "main",
      worktreePath,
      branch,
      specPath,
      ...(stageId === "implement" ? TERMINAL_PR : {}),
    });
    if (stageId === "intent" && twoBranchFanOut) {
      store.setRunDownstreamInputs(
        runId,
        branchKeys.map((key) => branchReadyIntentSpec(key)),
      );
    }
    if (stageId === "plan" && dispatchCounts.plan === 1) {
      firstPlanRunId = runId;
    }
    return { ok: true, entryRunId: runId };
  };

  const wait: PipelineWorkflowWait = async (entryRunId) => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    if (options.failFirstPlanWait && entryRunId === firstPlanRunId) return "failed";
    return "completed";
  };

  return {
    dispatch,
    wait,
    dispatchCounts,
    firstPlanRunId: () => firstPlanRunId,
  };
}

type Harness = {
  store: StateStore;
  handlers: ReturnType<typeof createRunControlHandlers>;
  definition: PipelineDefinition;
  context: {
    cwd: string;
    seed: string;
    configPath: string;
    projectRegistry: Record<string, { root: string }>;
  };
  settlement: ReturnType<typeof deferred<void>>;
  dispatchCounts: Record<string, number>;
  fakeExecutor: ReturnType<typeof createFakeWriteLoopExecutor>;
};

function createHarness(
  repoRoot: string,
  _jarvisRoot: string,
  configPath: string,
  fakeOptions: FakeInvocationOptions & { settlement?: ReturnType<typeof deferred<void>> } = {},
): Harness {
  const store = openStateStore(join(tmpdir(), `jarvis-pipeline-e2e-${process.pid}-${Date.now()}-${Math.random()}.db`));
  const settlement = fakeOptions.settlement ?? deferred<void>();
  const fakeInvocation = createFakePipelineInvocation(store, repoRoot, {
    extraPlanArtifacts: [PLAN_WORK_SPEC],
    ...fakeOptions,
  });
  const fakeExecutor = createFakeWriteLoopExecutor();
  const resolution = resolveProjectPipeline(
    {
      projectKey: PROJECT_KEY,
      pipeline: { name: "full-review", terminalAction: "ready" },
    },
    getPipelineDefinition,
    ALL_REVIEW_ROLES_CONFIG,
  );
  if (!resolution.ok) throw new Error(`resolveProjectPipeline failed: ${JSON.stringify(resolution)}`);

  const handlers = createRunControlHandlers({
    stateStore: store,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage: fastProductionResolveStage,
    pipelineDispatch: fakeInvocation.dispatch,
    pipelineWait: fakeInvocation.wait,
    executeTerminalPublication: async () => {
      await settlement.promise;
      return TERMINAL_PR;
    },
  });

  return {
    store,
    handlers,
    definition: resolution.definition,
    context: {
      cwd: repoRoot,
      seed: "Ship feature",
      configPath,
      projectRegistry: { [PROJECT_KEY]: { root: repoRoot } },
    },
    settlement,
    dispatchCounts: fakeInvocation.dispatchCounts,
    fakeExecutor,
  };
}

function createFastHarness(
  repoRoot: string,
  _jarvisRoot: string,
  configPath: string,
  artifactTemplatesDir: string,
  options: { twoBranchFanOut?: boolean } = {},
): Harness {
  const twoBranchFanOut = options.twoBranchFanOut ?? false;
  const store = openStateStore(
    join(
      tmpdir(),
      `jarvis-pipeline-fast${twoBranchFanOut ? "-fan-out" : ""}-e2e-${process.pid}-${Date.now()}-${Math.random()}.db`,
    ),
  );
  const fakeInvocation = createFakePipelineInvocation(store, repoRoot, {
    ...(twoBranchFanOut
      ? { twoBranchFanOut: true, branchKeys: FAN_OUT_BRANCH_KEYS }
      : {
          dispatchSequence: ["intent", "plan", "implement"],
          extraPlanArtifacts: [PLAN_WORK_SPEC],
        }),
    artifactRoot: artifactTemplatesDir,
    gitWorktrees: true,
  });
  const fakeExecutor = createFakeWriteLoopExecutor();
  const selected = getPipelineDefinition("fast");
  if (!selected.ok) throw new Error(`getPipelineDefinition failed: ${JSON.stringify(selected)}`);

  const handlers = createRunControlHandlers({
    stateStore: store,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage: fastProductionResolveStage,
    pipelineDispatch: fakeInvocation.dispatch,
    pipelineWait: fakeInvocation.wait,
  });

  return {
    store,
    handlers,
    definition: selected.definition,
    context: {
      cwd: repoRoot,
      seed: "Ship feature",
      configPath,
      projectRegistry: { [PROJECT_KEY]: { root: repoRoot } },
    },
    settlement: deferred<void>(),
    dispatchCounts: fakeInvocation.dispatchCounts,
    fakeExecutor,
  };
}

function fastStageStatusVector(pipeline: LoadedPipeline): string[] {
  return FAST_STAGE_IDS.map(
    (stageId) => pipeline.stages.find((stage) => stage.stageId === stageId)?.status ?? "missing",
  );
}

function fastStageStatusForBranch(pipeline: LoadedPipeline, stageId: string, branchKey: string): string {
  return (
    pipeline.stages.find((stage) => stage.stageId === stageId && stage.branchKey === branchKey)?.status ?? "missing"
  );
}

function fastTwoBranchStatusVector(pipeline: LoadedPipeline): string[] {
  return [
    fastStageStatusForBranch(pipeline, "intent", "default"),
    fastStageStatusForBranch(pipeline, "plan", "alpha"),
    fastStageStatusForBranch(pipeline, "plan", "beta"),
    fastStageStatusForBranch(pipeline, "implement", "alpha"),
    fastStageStatusForBranch(pipeline, "implement", "beta"),
  ];
}

const FAST_TWO_BRANCH_SUCCESS_VECTOR = ["succeeded", "succeeded", "succeeded", "succeeded", "succeeded"] as const;

function readPipeline(store: StateStore, pipelineId: string): LoadedPipeline {
  const pipeline = store.loadPipeline(pipelineId);
  if (!pipeline) throw new Error("expected pipeline");
  return pipeline;
}

async function _loadPipeline(store: StateStore, pipelineId: string): Promise<LoadedPipeline> {
  return readPipeline(store, pipelineId);
}

async function expectVector(
  store: StateStore,
  pipelineId: string,
  expected: readonly string[],
): Promise<LoadedPipeline> {
  await waitFor(() => {
    const pipeline = store.loadPipeline(pipelineId);
    if (!pipeline) return false;
    return stageStatusVector(pipeline).join(",") === expected.join(",");
  });
  return readPipeline(store, pipelineId);
}

describe("pipeline end-to-end full-review", () => {
  const roots: string[] = [];
  let previousJarvisHome: string | undefined;
  let repoRoot: string;
  let jarvisRoot: string;
  let configPath: string;

  beforeEach(() => {
    const setup = setupPipelineSandboxRepo(roots);
    repoRoot = setup.repoRoot;
    jarvisRoot = setup.jarvisRoot;
    _sandboxRepoRoot = repoRoot;
    resolveStageMachinesDir = join(jarvisRoot, "machines");
    previousJarvisHome = process.env.JARVIS_HOME;
    process.env.JARVIS_HOME = jarvisRoot;
    writeMachineProfile(jarvisRoot);
    configPath = join(jarvisRoot, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        machineProfile: "home",
        agents: ["claude"],
        projects: {
          [PROJECT_KEY]: {
            root: repoRoot,
            pipeline: { name: "full-review", terminalAction: "ready" },
          },
        },
      }),
    );
  });

  afterEach(async () => {
    setInvertResumeFailedRequiresReopenForTest(false);
    if (previousJarvisHome === undefined) delete process.env.JARVIS_HOME;
    else process.env.JARVIS_HOME = previousJarvisHome;
    await flushBackgroundRuns();
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("admits through handlers, fails first plan via faked wait, resumes, approves gates, and settles ready", async () => {
    const harness = createHarness(repoRoot, jarvisRoot, configPath, { failFirstPlanWait: true });
    const { store, handlers, definition, context, settlement } = harness;

    const start = await handlers.pipeline_start(
      requestFrame("start", "pipeline_start", { definition, context }),
      new AbortController().signal,
    );
    expect(start.kind).toBe("response");
    const pipelineId = (start as { result: { pipelineId: string } }).result.pipelineId;

    let pipeline = await expectVector(store, pipelineId, ["pending", "pending", "pending", "pending", "pending"]);

    await waitFor(
      () =>
        stageStatusVector(readPipeline(store, pipelineId)).join(",") === "succeeded,awaiting,pending,pending,pending",
    );
    pipeline = readPipeline(store, pipelineId);
    expect(stageStatusVector(pipeline)).toEqual(["succeeded", "awaiting", "pending", "pending", "pending"]);
    expect(derivePipelineState(pipeline)).toBe("awaiting-approval");

    const approveIntent = await handlers.pipeline_approve(
      requestFrame("approve-intent", "pipeline_approve", { pipelineId, stageId: "approve-intent" }),
      new AbortController().signal,
    );
    expect(approveIntent).toEqual({
      kind: "response",
      result: { kind: "applied", pipelineId, stageId: "approve-intent", decision: "approved" },
    });

    await waitFor(
      () =>
        stageStatusVector(readPipeline(store, pipelineId)).join(",") === "succeeded,approved,running,pending,pending",
    );
    pipeline = readPipeline(store, pipelineId);
    expect(stageStatusVector(pipeline)).toEqual(["succeeded", "approved", "running", "pending", "pending"]);

    await waitFor(
      () =>
        stageStatusVector(readPipeline(store, pipelineId)).join(",") === "succeeded,approved,failed,skipped,skipped",
    );
    pipeline = readPipeline(store, pipelineId);
    expect(stageStatusVector(pipeline)).toEqual(["succeeded", "approved", "failed", "skipped", "skipped"]);
    expect(derivePipelineState(pipeline)).toBe("failed");
    const intentInvocationId = pipeline.stages.find((stage) => stage.stageId === "intent")?.workflowInvocationId;
    expect(intentInvocationId).toBeTruthy();

    const resume = await handlers.pipeline_resume(
      requestFrame("resume", "pipeline_resume", { pipelineId }),
      new AbortController().signal,
    );
    expect(resume).toEqual({ kind: "response", result: { kind: "resumed", pipelineId } });

    pipeline = await expectVector(store, pipelineId, ["succeeded", "approved", "pending", "pending", "pending"]);

    await waitFor(
      () =>
        stageStatusVector(readPipeline(store, pipelineId)).join(",") === "succeeded,approved,running,pending,pending",
    );
    pipeline = readPipeline(store, pipelineId);
    expect(stageStatusVector(pipeline)).toEqual(["succeeded", "approved", "running", "pending", "pending"]);

    await waitFor(
      () =>
        stageStatusVector(readPipeline(store, pipelineId)).join(",") ===
        "succeeded,approved,succeeded,awaiting,pending",
    );
    pipeline = readPipeline(store, pipelineId);
    expect(stageStatusVector(pipeline)).toEqual(["succeeded", "approved", "succeeded", "awaiting", "pending"]);
    expect(pipeline.stages.find((stage) => stage.stageId === "intent")?.workflowInvocationId).toBe(intentInvocationId);
    const resumedPlanInvocationId = pipeline.stages.find((stage) => stage.stageId === "plan")?.workflowInvocationId;
    expect(resumedPlanInvocationId).toBeTruthy();
    expect(resumedPlanInvocationId).not.toBe(intentInvocationId);

    const approvePlan = await handlers.pipeline_approve(
      requestFrame("approve-plan", "pipeline_approve", { pipelineId, stageId: "approve-plan" }),
      new AbortController().signal,
    );
    expect(approvePlan).toEqual({
      kind: "response",
      result: { kind: "applied", pipelineId, stageId: "approve-plan", decision: "approved" },
    });

    await waitFor(
      () =>
        stageStatusVector(readPipeline(store, pipelineId)).join(",") ===
        "succeeded,approved,succeeded,approved,running",
      10_000,
      `implement-running vector=${stageStatusVector(readPipeline(store, pipelineId)).join(",")} implement=${readPipeline(store, pipelineId)?.stages.find((s) => s.stageId === "implement")?.status} detail=${JSON.stringify(readPipeline(store, pipelineId)?.stages.find((s) => s.stageId === "implement")?.failureDetail)} counts=${JSON.stringify(harness.dispatchCounts)}`,
    );
    pipeline = readPipeline(store, pipelineId);
    expect(stageStatusVector(pipeline)).toEqual(["succeeded", "approved", "succeeded", "approved", "running"]);

    await waitFor(
      () =>
        stageStatusVector(readPipeline(store, pipelineId)).join(",") ===
        "succeeded,approved,succeeded,approved,succeeded",
    );
    pipeline = readPipeline(store, pipelineId);
    expect(stageStatusVector(pipeline)).toEqual(["succeeded", "approved", "succeeded", "approved", "succeeded"]);
    expect(derivePipelineState(pipeline)).toBe("running");

    settlement.resolve();
    await waitFor(() => derivePipelineState(readPipeline(store, pipelineId)) === "succeeded");
    pipeline = readPipeline(store, pipelineId);
    expect(pipeline.terminalPublicationSucceededAt).not.toBeNull();
    expect(stageStatusVector(pipeline)).toEqual(["succeeded", "approved", "succeeded", "approved", "succeeded"]);
    expect(derivePipelineState(pipeline)).toBe("succeeded");

    expect(harness.dispatchCounts).toEqual({ intent: 1, plan: 2, implement: 1 });
    await flushBackgroundRuns();
    harness.fakeExecutor.abortAll();
  });

  test("dispatch-count assertions fail when intent is not dispatched", async () => {
    const harness = createHarness(repoRoot, jarvisRoot, configPath, {
      dispatchSequence: ["plan", "implement"],
      failFirstPlanWait: false,
    });
    const { store, handlers, definition, context } = harness;

    const start = await handlers.pipeline_start(
      requestFrame("start", "pipeline_start", { definition, context }),
      new AbortController().signal,
    );
    const pipelineId = (start as { result: { pipelineId: string } }).result.pipelineId;

    await waitFor(() => derivePipelineState(readPipeline(store, pipelineId)) !== "pending");
    expect(harness.dispatchCounts.intent).toBe(0);
    harness.fakeExecutor.abortAll();
  });

  test("inverting resumeFailedRequiresReopen refuses resume after plan failure", async () => {
    setInvertResumeFailedRequiresReopenForTest(true);
    const harness = createHarness(repoRoot, jarvisRoot, configPath, { failFirstPlanWait: true });
    const { store, handlers, definition, context } = harness;

    const start = await handlers.pipeline_start(
      requestFrame("start", "pipeline_start", { definition, context }),
      new AbortController().signal,
    );
    const pipelineId = (start as { result: { pipelineId: string } }).result.pipelineId;

    await waitFor(
      () =>
        stageStatusVector(readPipeline(store, pipelineId)).join(",") === "succeeded,awaiting,pending,pending,pending",
    );
    await handlers.pipeline_approve(
      requestFrame("approve-intent", "pipeline_approve", { pipelineId, stageId: "approve-intent" }),
      new AbortController().signal,
    );
    await waitFor(
      () =>
        stageStatusVector(readPipeline(store, pipelineId)).join(",") === "succeeded,approved,failed,skipped,skipped",
    );

    const resume = await handlers.pipeline_resume(
      requestFrame("resume", "pipeline_resume", { pipelineId }),
      new AbortController().signal,
    );
    expect(resume).toEqual({
      kind: "response",
      result: { kind: "refused", pipelineId, reason: "pipeline_not_resumable" },
    });
    harness.fakeExecutor.abortAll();
  });
});

describe("pipeline end-to-end fast", () => {
  const roots: string[] = [];
  let previousJarvisHome: string | undefined;
  let repoRoot: string;
  let jarvisRoot: string;
  let configPath: string;
  let artifactTemplatesDir: string;

  beforeEach(() => {
    const setup = setupFastPipelineSandboxRepo(roots);
    repoRoot = setup.repoRoot;
    jarvisRoot = setup.jarvisRoot;
    artifactTemplatesDir = setup.artifactTemplatesDir;
    resolveStageMachinesDir = join(jarvisRoot, "machines");
    previousJarvisHome = process.env.JARVIS_HOME;
    process.env.JARVIS_HOME = jarvisRoot;
    writeMachineProfile(jarvisRoot);
    configPath = join(jarvisRoot, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        machineProfile: "home",
        agents: ["claude"],
        projects: {
          [PROJECT_KEY]: {
            root: repoRoot,
            pipeline: { name: "fast" },
          },
        },
      }),
    );
  });

  afterEach(async () => {
    setInvertPriorWorktreeRootGuardForTest(false);
    setInvertResumeFailedRequiresReopenForTest(false);
    if (previousJarvisHome === undefined) delete process.env.JARVIS_HOME;
    else process.env.JARVIS_HOME = previousJarvisHome;
    await flushBackgroundRuns();
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("walks intent → plan → implement with chained artifacts only on stage worktrees", async () => {
    expect(existsSync(join(repoRoot, INTENT_SPEC))).toBe(false);
    expect(existsSync(join(repoRoot, PLAN_SPEC))).toBe(false);

    const harness = createFastHarness(repoRoot, jarvisRoot, configPath, artifactTemplatesDir);
    const { store, handlers, definition, context } = harness;

    const start = await handlers.pipeline_start(
      requestFrame("start", "pipeline_start", { definition, context }),
      new AbortController().signal,
    );
    expect(start.kind).toBe("response");
    const pipelineId = (start as { result: { pipelineId: string } }).result.pipelineId;

    await waitFor(
      () => fastStageStatusVector(readPipeline(store, pipelineId)).join(",") === "succeeded,succeeded,succeeded",
      10_000,
      `fast vector=${fastStageStatusVector(readPipeline(store, pipelineId)).join(",")} implement=${readPipeline(store, pipelineId)?.stages.find((s) => s.stageId === "implement")?.status} detail=${JSON.stringify(readPipeline(store, pipelineId)?.stages.find((s) => s.stageId === "implement")?.failureDetail)}`,
    );
    const pipeline = readPipeline(store, pipelineId);
    expect(fastStageStatusVector(pipeline)).toEqual(["succeeded", "succeeded", "succeeded"]);
    expect(derivePipelineState(pipeline)).toBe("succeeded");
    expect(harness.dispatchCounts).toEqual({ intent: 1, plan: 1, implement: 1 });
    harness.fakeExecutor.abortAll();
  });

  test("inverting prior-worktree guard fails chained resolution", async () => {
    setInvertPriorWorktreeRootGuardForTest(true);
    const harness = createFastHarness(repoRoot, jarvisRoot, configPath, artifactTemplatesDir);
    const { store, handlers, definition, context } = harness;

    const start = await handlers.pipeline_start(
      requestFrame("start", "pipeline_start", { definition, context }),
      new AbortController().signal,
    );
    const pipelineId = (start as { result: { pipelineId: string } }).result.pipelineId;

    await waitFor(() => derivePipelineState(readPipeline(store, pipelineId)) !== "pending");
    const pipeline = readPipeline(store, pipelineId);
    expect(fastStageStatusVector(pipeline)).not.toEqual(["succeeded", "succeeded", "succeeded"]);
    expect(derivePipelineState(pipeline)).not.toBe("succeeded");
    harness.fakeExecutor.abortAll();
  });

  describe("two-ready-intent fan-out", () => {
    let fanOutRepoRoot: string;
    let fanOutJarvisRoot: string;
    let fanOutConfigPath: string;
    let fanOutArtifactTemplatesDir: string;

    beforeEach(() => {
      const setup = setupFastTwoBranchPipelineSandboxRepo(roots);
      fanOutRepoRoot = setup.repoRoot;
      fanOutJarvisRoot = setup.jarvisRoot;
      fanOutArtifactTemplatesDir = setup.artifactTemplatesDir;
      process.env.JARVIS_HOME = fanOutJarvisRoot;
      resolveStageMachinesDir = join(fanOutJarvisRoot, "machines");
      writeMachineProfile(fanOutJarvisRoot);
      fanOutConfigPath = join(fanOutJarvisRoot, "config.json");
      writeFileSync(
        fanOutConfigPath,
        JSON.stringify({
          machineProfile: "home",
          agents: ["claude"],
          projects: {
            [PROJECT_KEY]: {
              root: fanOutRepoRoot,
              pipeline: { name: "fast" },
            },
          },
        }),
      );
    });

    afterEach(() => {
      setCollapseFanOutToFirstInputForTest(false);
    });

    test("walks intent → plan → implement on separate branches with dispatch count 2 per downstream stage", async () => {
      expect(existsSync(join(fanOutRepoRoot, INTENT_ALPHA))).toBe(false);
      expect(existsSync(join(fanOutRepoRoot, INTENT_BETA))).toBe(false);
      expect(existsSync(join(fanOutRepoRoot, PLAN_ALPHA_SPEC))).toBe(false);
      expect(existsSync(join(fanOutRepoRoot, PLAN_BETA_SPEC))).toBe(false);

      const harness = createFastHarness(
        fanOutRepoRoot,
        fanOutJarvisRoot,
        fanOutConfigPath,
        fanOutArtifactTemplatesDir,
        { twoBranchFanOut: true },
      );
      const { store, handlers, definition, context } = harness;

      const start = await handlers.pipeline_start(
        requestFrame("start", "pipeline_start", { definition, context }),
        new AbortController().signal,
      );
      expect(start.kind).toBe("response");
      const pipelineId = (start as { result: { pipelineId: string } }).result.pipelineId;

      await waitFor(
        () =>
          fastTwoBranchStatusVector(readPipeline(store, pipelineId)).join(",") ===
          FAST_TWO_BRANCH_SUCCESS_VECTOR.join(","),
        10_000,
        `fast fan-out vector=${fastTwoBranchStatusVector(readPipeline(store, pipelineId)).join(",")} detail=${JSON.stringify(readPipeline(store, pipelineId)?.stages.map((s) => ({ id: s.stageId, branch: s.branchKey, status: s.status, failure: s.failureDetail })))}`,
      );
      const pipeline = readPipeline(store, pipelineId);
      expect(fastTwoBranchStatusVector(pipeline)).toEqual([...FAST_TWO_BRANCH_SUCCESS_VECTOR]);
      expect(fastStageStatusVector(pipeline)).not.toEqual(["succeeded", "succeeded", "succeeded"]);
      expect(derivePipelineState(pipeline)).toBe("succeeded");
      expect(harness.dispatchCounts).toEqual({ intent: 1, plan: 2, implement: 2 });
      harness.fakeExecutor.abortAll();
    });

    test("collapsing fan-out to one branch fails before full success", async () => {
      setCollapseFanOutToFirstInputForTest(true);
      const harness = createFastHarness(
        fanOutRepoRoot,
        fanOutJarvisRoot,
        fanOutConfigPath,
        fanOutArtifactTemplatesDir,
        { twoBranchFanOut: true },
      );
      const { store, handlers, definition, context } = harness;

      const start = await handlers.pipeline_start(
        requestFrame("start", "pipeline_start", { definition, context }),
        new AbortController().signal,
      );
      const pipelineId = (start as { result: { pipelineId: string } }).result.pipelineId;

      await waitFor(() => derivePipelineState(readPipeline(store, pipelineId)) !== "pending");
      const pipeline = readPipeline(store, pipelineId);
      expect(fastTwoBranchStatusVector(pipeline)).not.toEqual([...FAST_TWO_BRANCH_SUCCESS_VECTOR]);
      expect(derivePipelineState(pipeline)).not.toBe("succeeded");
      harness.fakeExecutor.abortAll();
    });
  });
});
