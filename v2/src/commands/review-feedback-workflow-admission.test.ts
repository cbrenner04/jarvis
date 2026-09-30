import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { trackedMkdtempSync } from "../../../shared/tracked-temp-dir.test-support.ts";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import { getExternalWorktreePath } from "../execution/external-worktree.ts";
import { WORKFLOW_PRESET_BUILDERS } from "../execution/workflow-presets.ts";
import {
  DEFAULT_PIPELINE_STAGE_BRANCH_KEY,
  type Pipeline,
  type PipelineStageRecord,
  type Run,
  type StateStore,
} from "../persistence/state-store.ts";
import type { ReviewFeedbackLaneResolutionStore } from "../persistence/review-feedback-lane-resolution.ts";
import { createRuntimeDeps } from "../cli/deps.ts";
import { captureIo, cliMain, writeHomeMachineConfig } from "../testing/cli-test-helpers.ts";
import {
  formatReviewFeedbackWorkflowAdmissionRefusal,
  prepareReviewFeedbackWorkflowAdmission,
  REVIEW_FEEDBACK_WRITE_NOT_AVAILABLE,
  runReviewFeedbackWorkflowCommand,
} from "./review-feedback-workflow-admission.ts";

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

function memoryStore(args: {
  runs: Run[];
  pipelines?: Array<Pipeline & { stages: PipelineStageRecord[] }>;
}): ReviewFeedbackLaneResolutionStore {
  const runs = args.runs;
  const pipelines = args.pipelines ?? [];
  return {
    listRuns: () => runs,
    findRunsByInvocationId: (invocationId) => runs.filter((run) => run.workflowSnapshot?.invocationId === invocationId),
    loadRun: (runId) => (runs.find((run) => run.id === runId) ?? null) as ReturnType<StateStore["loadRun"]>,
    loadPipeline: (pipelineId) => pipelines.find((pipeline) => pipeline.id === pipelineId) ?? null,
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

type AdmissionPrView = {
  state: string;
  headRefName: string;
  url: string;
  reviews: Array<{ submittedAt?: string | null }>;
};

function openReviewedAdmissionView(overrides: Partial<AdmissionPrView> = {}): AdmissionPrView {
  return {
    state: "OPEN",
    headRefName: BRANCH,
    url: "https://github.com/owner/repo/pull/42",
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
      if (args[0] === "pr" && args[1] === "view" && args.includes("state,headRefName,url,reviews")) {
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

    const cap = captureIo();
    const code = await runReviewFeedbackWorkflowCommand(
      ["--branch", BRANCH],
      { ok: true, branch: BRANCH },
      cap.io,
      createRuntimeDeps({
        cwd: () => fixtureRoot,
        readProjectRegistry: () => ({ [PROJECT]: { root: fixtureRoot } }),
        machineConfigPath,
        reviewFeedbackLaneStore: memoryStore({ runs: [run] }),
        subprocessRunner: runner,
      }),
    );
    expect(code).toBe(1);
    expect(cap.read().stderr).toContain(REVIEW_FEEDBACK_WRITE_NOT_AVAILABLE);
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
    const preparation = await prepareOk(run, createGhRunner({ admissionView: openReviewedAdmissionView() }));
    const writeStep = preparation.steps[0];
    expect(writeStep?.behavior === "write" && writeStep.role).toBe("plan");
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
    const preparation = await prepareOk(run, createGhRunner({ admissionView: openReviewedAdmissionView() }));
    const writeStep = preparation.steps[0];
    expect(writeStep?.behavior === "write" && writeStep.role).toBe("implement");
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
    const outcome = await prepareReviewFeedbackWorkflowAdmission(
      {
        ok: true,
        branch: BRANCH,
        pipelineId: "pipe-1",
        stageId: "intent-stage",
        branchKey: "feature-a",
      },
      admissionDeps(
        memoryStore({ runs: [entryRun], pipelines: [pipeline] }),
        createGhRunner({ admissionView: openReviewedAdmissionView() }),
      ),
    );
    expect(outcome.ok).toBe(true);
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

  test("CLI admission refuses with stable code and does not contact the daemon", async () => {
    const run = baseRun({ id: "intent-entry", worktreePath: worktreePathForCapture });
    const sent: unknown[] = [];
    const cap = captureIo();
    const code = await cliMain(
      ["run", "workflow", "review-feedback", "--branch", BRANCH],
      cap.io,
      createRuntimeDeps({
        cwd: () => fixtureRoot,
        readProjectRegistry: () => ({ [PROJECT]: { root: fixtureRoot } }),
        machineConfigPath,
        reviewFeedbackLaneStore: memoryStore({ runs: [run] }),
        subprocessRunner: createGhRunner({ admissionView: openReviewedAdmissionView() }),
        connectIpcClient: async () => {
          throw new Error("daemon must not be contacted");
        },
      }),
    );
    expect(code).toBe(1);
    expect(sent).toHaveLength(0);
    expect(cap.read().stderr).toContain(
      formatReviewFeedbackWorkflowAdmissionRefusal({
        code: REVIEW_FEEDBACK_WRITE_NOT_AVAILABLE,
        message: "review-feedback write dispatch is not available yet",
      }),
    );
  });
});
