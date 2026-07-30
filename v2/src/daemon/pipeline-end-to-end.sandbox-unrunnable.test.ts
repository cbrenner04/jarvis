import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import { buildImplementWorkflowSteps } from "../execution/implement-workflow-steps.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import { getPipelineDefinition } from "../execution/pipeline-registry.ts";
import { resolveProjectPipeline } from "../execution/project-pipeline-resolution.ts";
import { buildReviewedPlanWorkflowSteps, type PlanWorkflowInput } from "../execution/publication-workflow-steps.ts";
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
import { resolveStageWorkflowSteps } from "./pipeline-stage-resolve.ts";

const PROJECT_KEY = "demo";
const STAGE_IDS = ["intent", "approve-intent", "plan", "approve-plan", "implement"] as const;
const INTENT_SPEC = "v2/spec/ready-intents/ship-feature.md";
const PLAN_SPEC = "v2/spec/ship-feature/index.md";
const TERMINAL_PR = { prNumber: 42, prUrl: "https://github.com/org/repo/pull/42" } as const;
const FAST_SUBPROCESS_RUNNER: AsyncSubprocessRunner = {
  runAsync: async () => "",
};

let sandboxRepoRoot = "";
let resolveStageMachinesDir = "";

function loadStepsWithProfile(steps: Parameters<typeof loadWorkflowSteps>[0]) {
  return loadWorkflowSteps(steps, { machineProfile: "home", machinesDir: resolveStageMachinesDir });
}

// `resolveStageWorkflowSteps` widens every preset input to `BuildImplementWorkflowStepsInput`
// before dispatch, so the map's declared signature is looser than each builder's real input.
function makeResolveStageBuilders(): typeof WORKFLOW_PRESET_BUILDERS {
  const builders = {
    ...WORKFLOW_PRESET_BUILDERS,
    "plan-reviewed": (input: PlanWorkflowInput) =>
      buildReviewedPlanWorkflowSteps(input, {
        resolveProjectMatch: (cwd) => ({ key: PROJECT_KEY, root: cwd }),
        resolveBaseBranch: async () => "HEAD",
        readReadyIntent: () => ({
          ok: true as const,
          name: "ship-feature",
          content: readFileSync(join(sandboxRepoRoot, INTENT_SPEC), "utf8"),
        }),
        loadWorkflowSteps: loadStepsWithProfile,
      }),
    implement: (input: Parameters<typeof buildImplementWorkflowSteps>[0]) =>
      buildImplementWorkflowSteps(
        { ...input, reviewPasses: 0, reviewBehavior: "light", projectName: PROJECT_KEY },
        {
          asyncSubprocessRunner: FAST_SUBPROCESS_RUNNER,
          readSpecFile: (path) => readFileSync(path, "utf8"),
          resolveProjectMatch: (cwd) => ({ key: PROJECT_KEY, root: cwd }),
          resolveActiveLinkedSubspec: () => ({ ok: false, error: "empty", errorKind: "empty_index" }),
          loadWorkflowSteps: loadStepsWithProfile,
        },
      ),
  };
  return builders as unknown as typeof WORKFLOW_PRESET_BUILDERS;
}

function productionResolveStage(
  definition: PipelineDefinition,
  stageIndex: number,
  context: Parameters<typeof resolveStageWorkflowSteps>[2],
  stageArtifacts: Parameters<typeof resolveStageWorkflowSteps>[3],
  deps: Parameters<typeof resolveStageWorkflowSteps>[4] = {},
) {
  return resolveStageWorkflowSteps(definition, stageIndex, context, stageArtifacts, {
    resolveBaseRef: async () => "HEAD",
    builders: makeResolveStageBuilders(),
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
  writeFileSync(
    join(repoRoot, PLAN_SPEC),
    "---\nname: ship-feature\n---\n\n## Prerequisites\n\nnone\n\n## Acceptance criteria\n\n- [ ] pending\n",
    "utf8",
  );

  execFileSync("git", ["init", repoRoot], { stdio: "pipe" });
  execFileSync("git", ["-C", repoRoot, "config", "user.email", "test@example.com"], { stdio: "pipe" });
  execFileSync("git", ["-C", repoRoot, "config", "user.name", "Test User"], { stdio: "pipe" });
  execFileSync("git", ["-C", repoRoot, "add", "-A"], { stdio: "pipe" });
  execFileSync("git", ["-C", repoRoot, "commit", "-m", "seed"], { stdio: "pipe" });

  return { repoRoot, jarvisRoot };
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
  const dispatchSequence = options.dispatchSequence ?? ["intent", "plan", "plan", "implement"];
  let dispatchIndex = 0;
  let firstPlanRunId: string | undefined;

  const branchForStage = (stageId: string): string => {
    if (stageId === "intent") return "intent/ship-feature";
    if (stageId === "plan") return "plan/ship-feature";
    return "implement/ship-feature";
  };

  const specForStage = (stageId: string): string => {
    if (stageId === "intent") return INTENT_SPEC;
    return PLAN_SPEC;
  };

  const seedWorktreeArtifact = (worktreePath: string, specPath: string): void => {
    const sourcePath = join(repoRoot, specPath);
    const targetPath = join(worktreePath, specPath);
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, readFileSync(sourcePath, "utf8"), "utf8");
  };

  const dispatch: PipelineWorkflowDispatch = async () => {
    const stageId = dispatchSequence[dispatchIndex];
    if (stageId === undefined) throw new Error("unexpected pipeline dispatch");
    dispatchIndex += 1;
    dispatchCounts[stageId] = (dispatchCounts[stageId] ?? 0) + 1;
    const branch = branchForStage(stageId);
    const worktreePath = join(repoRoot, ".jarvis-worktrees", branch);
    const specPath = specForStage(stageId);
    seedWorktreeArtifact(worktreePath, specPath);
    const runId = store.createRun({
      project: PROJECT_KEY,
      specRef: "main",
      worktreePath,
      branch,
      specPath,
      ...(stageId === "implement" ? TERMINAL_PR : {}),
    });
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
  const fakeInvocation = createFakePipelineInvocation(store, repoRoot, fakeOptions);
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
    resolveStage: productionResolveStage,
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
    sandboxRepoRoot = repoRoot;
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
