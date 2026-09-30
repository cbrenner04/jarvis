import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { trackedMkdtempSync } from "../../../shared/tracked-temp-dir.test-support.ts";
import { createRuntimeDeps } from "../cli/deps.ts";
import { getExternalWorktreePath } from "../execution/external-worktree.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import { WORKFLOW_PRESET_BUILDERS } from "../execution/workflow-presets.ts";
import type { ReviewFeedbackLaneResolutionStore } from "../persistence/review-feedback-lane-resolution.ts";
import {
  DEFAULT_PIPELINE_STAGE_BRANCH_KEY,
  type Pipeline,
  type PipelineStageRecord,
  type Run,
  type StateStore,
} from "../persistence/state-store.ts";
import {
  COMPLETED_WAIT_RESULT,
  captureIo,
  cliMain,
  makeStaleResetIpcClient,
  withWorkflowUuids,
  workflowFrames,
  writeHomeMachineConfig,
} from "../testing/cli-test-helpers.ts";
import { withFixedUuid } from "../testing/fixed-uuid.ts";
import {
  prepareReviewFeedbackWorkflowAdmission,
  REVIEW_FEEDBACK_WRITE_NOT_AVAILABLE,
  runReviewFeedbackWorkflowCommand,
} from "./review-feedback-workflow-admission.ts";
import type { ReviewFeedbackWorkflowCliInput } from "./workflow-args.ts";

const PROJECT = "demo";
const BRANCH = "lane-branch";
const WORKTREE = "/worktrees/lane";

function workflowSnapshot(
  invocationId: string,
  firstStep: { stepId: string; role: string; promptId?: string },
): NonNullable<Run["workflowSnapshot"]> {
  return { invocationId, steps: [firstStep] };
}

function baseRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    project: PROJECT,
    specRef: "main",
    createdAt: 1,
    status: "completed",
    attemptCount: 0,
    worktreePath: WORKTREE,
    branch: BRANCH,
    specPath: "spec.md",
    prNumber: 42,
    prUrl: "https://example.test/pull/42",
    stepId: "step-1",
    workflowSnapshot: workflowSnapshot("inv-1", {
      stepId: "step-1",
      role: "author",
      promptId: "intent.prompt.split",
    }),
    ...overrides,
  };
}

type HarnessFlipLineageQuery = Parameters<StateStore["findNewestHarnessReadyFlipEvidenceInLineage"]>[0];
type HarnessFlipLineageEvidence = ReturnType<StateStore["findNewestHarnessReadyFlipEvidenceInLineage"]>;

type ReviewFeedbackAdmissionStore = ReviewFeedbackLaneResolutionStore &
  Pick<StateStore, "findNewestHarnessReadyFlipEvidenceInLineage">;

function memoryStore(args: {
  runs: Run[];
  pipelines?: Array<Pipeline & { stages: PipelineStageRecord[] }>;
  harnessFlipEvidenceInLineage?: (query: HarnessFlipLineageQuery) => HarnessFlipLineageEvidence;
}): ReviewFeedbackLaneResolutionStore | ReviewFeedbackAdmissionStore {
  const runs = args.runs;
  const pipelines = args.pipelines ?? [];
  const base: ReviewFeedbackLaneResolutionStore = {
    listRuns: () => runs,
    findRunsByInvocationId: (invocationId: string) =>
      runs.filter((run) => run.workflowSnapshot?.invocationId === invocationId),
    loadRun: (runId: string) => (runs.find((run) => run.id === runId) ?? null) as ReturnType<StateStore["loadRun"]>,
    loadPipeline: (pipelineId: string) => pipelines.find((pipeline) => pipeline.id === pipelineId) ?? null,
  };
  if (args.harnessFlipEvidenceInLineage === undefined) {
    return base;
  }
  return {
    ...base,
    findNewestHarnessReadyFlipEvidenceInLineage: args.harnessFlipEvidenceInLineage,
  };
}

function pipelineFixture(args: {
  pipelineId: string;
  stageId: string;
  workflow: string;
  entryRun: Run;
  branchKey?: string;
}): Pipeline & { stages: PipelineStageRecord[] } {
  const branchKey = args.branchKey ?? DEFAULT_PIPELINE_STAGE_BRANCH_KEY;
  const definition: PipelineDefinition = {
    name: "test-pipeline",
    stages: [{ stageId: args.stageId, kind: "workflow", workflow: args.workflow, review: "none" }],
  };
  return {
    id: args.pipelineId,
    name: "test-pipeline",
    createdAt: 1,
    ownerIdentity: "owner",
    status: "active",
    definition,
    context: null,
    terminalPublicationFailure: null,
    terminalPublicationSucceededAt: null,
    supersedeFailures: null,
    dismissedAt: null,
    stages: [
      {
        id: "stage-row-1",
        pipelineId: args.pipelineId,
        stageId: args.stageId,
        branchKey,
        position: 0,
        status: "succeeded",
        workflowInvocationId: args.entryRun.id,
        startedAt: 1,
        endedAt: 2,
        artifact: null,
        failureDetail: null,
        decidedAt: null,
      },
    ],
  };
}

function fanOutPipelineFixture(args: {
  pipelineId: string;
  stageId: string;
  workflow: string;
  lanes: Array<{ branchKey: string; entryRun: Run }>;
}): Pipeline & { stages: PipelineStageRecord[] } {
  const definition: PipelineDefinition = {
    name: "test-pipeline",
    stages: [{ stageId: args.stageId, kind: "workflow", workflow: args.workflow, review: "none" }],
  };
  return {
    id: args.pipelineId,
    name: "test-pipeline",
    createdAt: 1,
    ownerIdentity: "owner",
    status: "active",
    definition,
    context: null,
    terminalPublicationFailure: null,
    terminalPublicationSucceededAt: null,
    supersedeFailures: null,
    dismissedAt: null,
    stages: args.lanes.map((lane, index) => ({
      id: `stage-row-${index}`,
      pipelineId: args.pipelineId,
      stageId: args.stageId,
      branchKey: lane.branchKey,
      position: index,
      status: "succeeded" as const,
      workflowInvocationId: lane.entryRun.id,
      startedAt: 1,
      endedAt: 2,
      artifact: null,
      failureDetail: null,
      decidedAt: null,
    })),
  };
}

type AdmissionPrView = {
  state: string;
  headRefName: string;
  url: string;
  isDraft: boolean;
  reviews: Array<{ submittedAt?: string | null }>;
};

function openReviewedAdmissionView(overrides: Partial<AdmissionPrView> = {}): AdmissionPrView {
  return {
    state: "OPEN",
    headRefName: BRANCH,
    url: "https://github.com/owner/repo/pull/42",
    isDraft: true,
    reviews: [{ submittedAt: "2026-05-10T00:00:00Z" }],
    ...overrides,
  };
}

function emptyCaptureGraphql(): string {
  return JSON.stringify({
    data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } },
  });
}

function createGhRunner(options: { admissionView: AdmissionPrView; captureThrows?: Error }): AsyncSubprocessRunner {
  return {
    runAsync: async (cmd, args, cwd) => {
      if (cmd !== "gh") throw new Error(`unexpected command ${cmd}`);
      if (args[0] === "pr" && args[1] === "view" && args.some((arg) => arg.includes("isDraft"))) {
        return JSON.stringify(options.admissionView);
      }
      if (options.captureThrows != null) throw options.captureThrows;
      if (args[0] === "repo" && args[1] === "view") return "owner/repo\n";
      if (args[0] === "api" && args[1] === "graphql") return emptyCaptureGraphql();
      if (args[0] === "pr" && args[1] === "view" && args.includes("reviews,comments")) {
        return JSON.stringify({ reviews: options.admissionView.reviews, comments: [] });
      }
      throw new Error(`unexpected gh invocation: ${args.join(" ")} in ${cwd}`);
    },
  };
}

let fixtureRoot: string;
let machineConfigPath: string;
let worktreePathForCapture: string;

beforeAll(() => {
  fixtureRoot = trackedMkdtempSync(join(process.cwd(), ".scratch", "review-feedback-admission-cli-"));
  mkdirSync(fixtureRoot, { recursive: true });
  machineConfigPath = writeHomeMachineConfig();
  worktreePathForCapture = trackedMkdtempSync("review-feedback-workflow-admission-");
});

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function admissionDeps(store: ReviewFeedbackLaneResolutionStore, runner: AsyncSubprocessRunner) {
  return {
    store,
    subprocessRunner: runner,
    machineConfigPath,
    builder: WORKFLOW_PRESET_BUILDERS["review-feedback"],
    project: PROJECT,
    projectRoot: fixtureRoot,
  };
}

function runtimeDepsForStore(store: ReviewFeedbackLaneResolutionStore, runner: AsyncSubprocessRunner) {
  return createRuntimeDeps({
    cwd: () => fixtureRoot,
    readProjectRegistry: () => ({ [PROJECT]: { root: fixtureRoot } }),
    machineConfigPath,
    reviewFeedbackLaneStore: store,
    subprocessRunner: runner,
  });
}

const DISPATCH_RUN_ID = "review-feedback-dispatch-run";

async function expectDispatchAfterAdmission(
  store: ReviewFeedbackLaneResolutionStore,
  runner: AsyncSubprocessRunner,
  parsed: Extract<ReviewFeedbackWorkflowCliInput, { ok: true }>,
) {
  const cap = captureIo();
  const code = await withFixedUuid(["dispatch-start", "dispatch-wait"], async () =>
    runReviewFeedbackWorkflowCommand([], parsed, cap.io, {
      ...runtimeDepsForStore(store, runner),
      connectIpcClient: async () =>
        makeStaleResetIpcClient(
          workflowFrames("dispatch-start", "dispatch-wait", DISPATCH_RUN_ID, COMPLETED_WAIT_RESULT),
        ),
    }),
  );
  expect(code).toBe(0);
  const output = cap.read();
  expect(output.stderr).not.toContain(REVIEW_FEEDBACK_WRITE_NOT_AVAILABLE);
  expect(output.stdout).toContain(`${DISPATCH_RUN_ID}\n`);
}

async function prepareOk(run: Run, runner: AsyncSubprocessRunner) {
  const outcome = await prepareReviewFeedbackWorkflowAdmission(
    { ok: true, branch: BRANCH },
    admissionDeps(memoryStore({ runs: [run] }), runner),
  );
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) throw new Error("expected preparation success");
  return outcome.preparation;
}

describe("review-feedback workflow admission", () => {
  test("prepares a completed bare intent lane with an open reviewed PR", async () => {
    const run = baseRun({
      id: "intent-entry",
      worktreePath: worktreePathForCapture,
      stepId: "intent-step",
      workflowSnapshot: workflowSnapshot("inv-intent", {
        stepId: "intent-step",
        role: "author",
        promptId: "intent.prompt.split",
      }),
    });
    const runner = createGhRunner({ admissionView: openReviewedAdmissionView() });
    const preparation = await prepareOk(run, runner);
    const writeStep = preparation.steps[0];
    expect(writeStep?.behavior).toBe("write");
    expect(writeStep?.behavior === "write" && writeStep.role).toBe("plan");

    await expectDispatchAfterAdmission(memoryStore({ runs: [run] }), runner, {
      ok: true,
      branch: BRANCH,
    });
  });

  test("prepares a completed bare plan lane", async () => {
    const run = baseRun({
      id: "plan-entry",
      worktreePath: worktreePathForCapture,
      stepId: "plan-step",
      workflowSnapshot: workflowSnapshot("inv-plan", {
        stepId: "plan-step",
        role: "author",
        promptId: "plan.prompt.draft",
      }),
    });
    const runner = createGhRunner({ admissionView: openReviewedAdmissionView() });
    const preparation = await prepareOk(run, runner);
    const writeStep = preparation.steps[0];
    expect(writeStep?.behavior === "write" && writeStep.role).toBe("plan");
    await expectDispatchAfterAdmission(memoryStore({ runs: [run] }), runner, { ok: true, branch: BRANCH });
  });

  test("prepares a completed bare implement lane", async () => {
    const run = baseRun({
      id: "implement-entry",
      worktreePath: worktreePathForCapture,
      stepId: "implement-step",
      workflowSnapshot: workflowSnapshot("inv-implement", {
        stepId: "implement-step",
        role: "implement",
        promptId: "implement.prompt.body",
      }),
    });
    const runner = createGhRunner({ admissionView: openReviewedAdmissionView() });
    const preparation = await prepareOk(run, runner);
    const writeStep = preparation.steps[0];
    expect(writeStep?.behavior === "write" && writeStep.role).toBe("implement");
    await expectDispatchAfterAdmission(memoryStore({ runs: [run] }), runner, { ok: true, branch: BRANCH });
  });

  test("prepares a completed pipeline stage with disambiguators", async () => {
    const entryRun = baseRun({
      id: "pipeline-intent-entry",
      worktreePath: worktreePathForCapture,
      stepId: "intent-step",
      workflowSnapshot: workflowSnapshot("inv-pipeline-intent", {
        stepId: "intent-step",
        role: "author",
        promptId: "intent.prompt.split",
      }),
    });
    const pipeline = pipelineFixture({
      pipelineId: "pipe-1",
      stageId: "intent-stage",
      workflow: "intent",
      entryRun,
      branchKey: "feature-a",
    });
    const runner = createGhRunner({ admissionView: openReviewedAdmissionView() });
    const store = memoryStore({ runs: [entryRun], pipelines: [pipeline] });
    const parsed = {
      ok: true as const,
      branch: BRANCH,
      pipelineId: "pipe-1",
      stageId: "intent-stage",
      branchKey: "feature-a",
    };
    const outcome = await prepareReviewFeedbackWorkflowAdmission(parsed, admissionDeps(store, runner));
    expect(outcome.ok).toBe(true);
    await expectDispatchAfterAdmission(store, runner, parsed);
  });

  test("prepares a fan-out pipeline stage when --branch-key disambiguates sibling rows", async () => {
    const entryRunA = baseRun({
      id: "pipeline-intent-entry-a",
      worktreePath: worktreePathForCapture,
      stepId: "intent-step-a",
      workflowSnapshot: workflowSnapshot("inv-pipeline-intent-a", {
        stepId: "intent-step-a",
        role: "author",
        promptId: "intent.prompt.split",
      }),
    });
    const entryRunB = baseRun({
      id: "pipeline-intent-entry-b",
      worktreePath: worktreePathForCapture,
      stepId: "intent-step-b",
      workflowSnapshot: workflowSnapshot("inv-pipeline-intent-b", {
        stepId: "intent-step-b",
        role: "author",
        promptId: "intent.prompt.split",
      }),
    });
    const pipeline = fanOutPipelineFixture({
      pipelineId: "pipe-fanout",
      stageId: "intent-stage",
      workflow: "intent",
      lanes: [
        { branchKey: "feature-a", entryRun: entryRunA },
        { branchKey: "feature-b", entryRun: entryRunB },
      ],
    });
    const runner = createGhRunner({ admissionView: openReviewedAdmissionView() });
    const store = memoryStore({ runs: [entryRunA, entryRunB], pipelines: [pipeline] });
    const parsed = {
      ok: true as const,
      branch: BRANCH,
      pipelineId: "pipe-fanout",
      stageId: "intent-stage",
      branchKey: "feature-b",
    };
    const outcome = await prepareReviewFeedbackWorkflowAdmission(parsed, admissionDeps(store, runner));
    expect(outcome).toMatchObject({ ok: true });
    const refused = await prepareReviewFeedbackWorkflowAdmission(
      { ok: true, branch: BRANCH, pipelineId: "pipe-fanout", stageId: "intent-stage" },
      admissionDeps(store, runner),
    );
    expect(refused).toMatchObject({ ok: false, refusal: { code: "review_feedback_lane_unmatched" } });
  });

  test("prepares using the resolved lane worktree path and branch", async () => {
    const laneWorktree = join(fixtureRoot, "resolved-lane");
    mkdirSync(laneWorktree, { recursive: true });
    const run = baseRun({
      id: "intent-entry",
      worktreePath: laneWorktree,
      branch: "resolved-branch",
      stepId: "intent-step",
      workflowSnapshot: workflowSnapshot("inv-intent", {
        stepId: "intent-step",
        role: "author",
        promptId: "intent.prompt.split",
      }),
    });
    const outcome = await prepareReviewFeedbackWorkflowAdmission(
      { ok: true, branch: "resolved-branch" },
      admissionDeps(
        memoryStore({ runs: [run] }),
        createGhRunner({ admissionView: openReviewedAdmissionView({ headRefName: "resolved-branch" }) }),
      ),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected preparation success");
    const preparation = outcome.preparation;
    const writeStep = preparation.steps[0];
    expect(writeStep?.behavior).toBe("write");
    if (writeStep?.behavior !== "write") throw new Error("expected write step");
    expect(writeStep.worktree.branchName).toBe("resolved-branch");
    expect(getExternalWorktreePath(writeStep.worktree)).toBe(laneWorktree);
    await expectDispatchAfterAdmission(
      memoryStore({ runs: [run] }),
      createGhRunner({ admissionView: openReviewedAdmissionView({ headRefName: "resolved-branch" }) }),
      { ok: true, branch: "resolved-branch" },
    );
  });

  test("refuses in-flight lane", async () => {
    const completed = baseRun({ id: "intent-entry" });
    const inFlight = baseRun({
      id: "other-run",
      status: "in-progress",
      stepId: "other-step",
      workflowSnapshot: workflowSnapshot("inv-other", { stepId: "other-step", role: "author" }),
    });
    const outcome = await prepareReviewFeedbackWorkflowAdmission(
      { ok: true, branch: BRANCH },
      admissionDeps(
        memoryStore({ runs: [completed, inFlight] }),
        createGhRunner({ admissionView: openReviewedAdmissionView() }),
      ),
    );
    expect(outcome).toMatchObject({ ok: false, refusal: { code: "review_feedback_lane_in_flight" } });
  });

  test("admits operator-flipped non-draft PR when lineage lookup finds harness ready-flip evidence", async () => {
    const run = baseRun({ id: "intent-entry", worktreePath: worktreePathForCapture });
    const store = memoryStore({
      runs: [run],
      harnessFlipEvidenceInLineage: (query) =>
        query.project === PROJECT &&
        query.specRef === "main" &&
        query.branch === BRANCH &&
        query.baseRef === "main" &&
        query.prNumber === 42
          ? { prNumber: 42, branch: BRANCH, baseRef: "main", flippedAt: 1 }
          : null,
    });
    const runner = createGhRunner({ admissionView: openReviewedAdmissionView({ isDraft: false }) });
    const outcome = await prepareReviewFeedbackWorkflowAdmission(
      { ok: true, branch: BRANCH },
      admissionDeps(store, runner),
    );
    expect(outcome.ok).toBe(true);
  });

  test("refuses non-draft PR without harness ready-flip evidence when store supports lineage lookup", async () => {
    const run = baseRun({ id: "intent-entry", worktreePath: worktreePathForCapture });
    const outcome = await prepareReviewFeedbackWorkflowAdmission(
      { ok: true, branch: BRANCH },
      admissionDeps(
        memoryStore({ runs: [run], harnessFlipEvidenceInLineage: () => null }),
        createGhRunner({ admissionView: openReviewedAdmissionView({ isDraft: false }) }),
      ),
    );
    expect(outcome).toMatchObject({ ok: false, refusal: { code: "review_feedback_pr_not_draft" } });
  });

  test("refuses open PR with no review", async () => {
    const run = baseRun({ id: "intent-entry", worktreePath: worktreePathForCapture });
    const outcome = await prepareReviewFeedbackWorkflowAdmission(
      { ok: true, branch: BRANCH },
      admissionDeps(
        memoryStore({ runs: [run] }),
        createGhRunner({ admissionView: openReviewedAdmissionView({ reviews: [] }) }),
      ),
    );
    expect(outcome).toMatchObject({ ok: false, refusal: { code: "review_feedback_pr_no_review" } });
  });

  test("refuses merged PR", async () => {
    const run = baseRun({ id: "intent-entry", worktreePath: worktreePathForCapture });
    const outcome = await prepareReviewFeedbackWorkflowAdmission(
      { ok: true, branch: BRANCH },
      admissionDeps(
        memoryStore({ runs: [run] }),
        createGhRunner({ admissionView: openReviewedAdmissionView({ state: "MERGED" }) }),
      ),
    );
    expect(outcome).toMatchObject({ ok: false, refusal: { code: "review_feedback_pr_merged" } });
  });

  test("refuses closed PR", async () => {
    const run = baseRun({ id: "intent-entry", worktreePath: worktreePathForCapture });
    const outcome = await prepareReviewFeedbackWorkflowAdmission(
      { ok: true, branch: BRANCH },
      admissionDeps(
        memoryStore({ runs: [run] }),
        createGhRunner({ admissionView: openReviewedAdmissionView({ state: "CLOSED" }) }),
      ),
    );
    expect(outcome).toMatchObject({ ok: false, refusal: { code: "review_feedback_pr_closed" } });
  });

  test("refuses non intent-plan-implement target", async () => {
    const run = baseRun({
      id: "debate-entry",
      stepId: "debate-step",
      workflowSnapshot: workflowSnapshot("inv-debate", {
        stepId: "debate-step",
        role: "author",
        promptId: "debate.prompt.body",
      }),
    });
    const outcome = await prepareReviewFeedbackWorkflowAdmission(
      { ok: true, branch: BRANCH },
      admissionDeps(memoryStore({ runs: [run] }), createGhRunner({ admissionView: openReviewedAdmissionView() })),
    );
    expect(outcome).toMatchObject({ ok: false, refusal: { code: "review_feedback_lane_not_eligible" } });
  });

  test("refuses unmatched lane", async () => {
    const outcome = await prepareReviewFeedbackWorkflowAdmission(
      { ok: true, branch: "missing-branch" },
      admissionDeps(memoryStore({ runs: [] }), createGhRunner({ admissionView: openReviewedAdmissionView() })),
    );
    expect(outcome).toMatchObject({ ok: false, refusal: { code: "review_feedback_lane_unmatched" } });
  });

  test("refuses ambiguous bare lane", async () => {
    const first = baseRun({
      id: "intent-a",
      stepId: "intent-a",
      workflowSnapshot: workflowSnapshot("inv-a", {
        stepId: "intent-a",
        role: "author",
        promptId: "intent.prompt.split",
      }),
    });
    const second = baseRun({
      id: "intent-b",
      stepId: "intent-b",
      workflowSnapshot: workflowSnapshot("inv-b", {
        stepId: "intent-b",
        role: "author",
        promptId: "intent.prompt.split",
      }),
    });
    const outcome = await prepareReviewFeedbackWorkflowAdmission(
      { ok: true, branch: BRANCH },
      admissionDeps(
        memoryStore({ runs: [first, second] }),
        createGhRunner({ admissionView: openReviewedAdmissionView() }),
      ),
    );
    expect(outcome).toMatchObject({ ok: false, refusal: { code: "review_feedback_lane_ambiguous" } });
  });

  test("refuses capture prelude failure", async () => {
    const run = baseRun({ id: "intent-entry", worktreePath: worktreePathForCapture });
    const outcome = await prepareReviewFeedbackWorkflowAdmission(
      { ok: true, branch: BRANCH },
      admissionDeps(
        memoryStore({ runs: [run] }),
        createGhRunner({
          admissionView: openReviewedAdmissionView(),
          captureThrows: new Error("capture failed"),
        }),
      ),
    );
    expect(outcome).toMatchObject({ ok: false, refusal: { code: "review_feedback_capture_failed" } });
  });

  test("CLI admission dispatches through the daemon after successful preparation", async () => {
    const run = baseRun({ id: "intent-entry", worktreePath: worktreePathForCapture });
    const cap = captureIo();
    const code = await withWorkflowUuids("cli-dispatch-start", "cli-dispatch-wait", async () =>
      cliMain(
        ["run", "workflow", "review-feedback", "--branch", BRANCH, "--detach"],
        cap.io,
        createRuntimeDeps({
          cwd: () => fixtureRoot,
          readProjectRegistry: () => ({ [PROJECT]: { root: fixtureRoot } }),
          machineConfigPath,
          reviewFeedbackLaneStore: memoryStore({ runs: [run] }),
          subprocessRunner: createGhRunner({ admissionView: openReviewedAdmissionView() }),
          connectIpcClient: async () =>
            makeStaleResetIpcClient(
              workflowFrames("cli-dispatch-start", "cli-dispatch-wait", DISPATCH_RUN_ID, COMPLETED_WAIT_RESULT),
            ),
          forceSkipAttachClientWait: true,
        }),
      ),
    );
    expect(code).toBe(0);
    const output = cap.read();
    expect(output.stderr).not.toContain(REVIEW_FEEDBACK_WRITE_NOT_AVAILABLE);
    expect(output.stdout).toContain(`${DISPATCH_RUN_ID}\n`);
  });
});
