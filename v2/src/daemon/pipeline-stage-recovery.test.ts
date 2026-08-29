import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planReviewPromptProfile } from "../../../shared/prompts/review-plan.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import {
  type AnyWorkflowStep,
  type ReviewDebateWorkflowStep,
  type ReviewWorkflowStep,
  recoverPlanStage,
  type WriteWorkflowStep,
} from "../execution/workflow-runner.ts";
import type { LogEvent, LogSink, PersistedRecord } from "../persistence/log-stream.ts";
import type { Pipeline, PipelineContext, PipelineStageRecord, Run, StateStore } from "../persistence/state-store.ts";
import { DEFAULT_AGENT_MODEL_CONFIG } from "../testing/workflow-step-fixtures.ts";
import { withStateStore } from "../testing/write-fixtures.ts";
import type { PipelineWorkflowDispatch, PipelineWorkflowWait } from "./pipeline-stage-dispatch.ts";
import {
  type PipelineStageRecoveryExecutionDeps,
  recoverPipelineBranchStage,
  resolveBlockedPlanStageRecoveryTarget,
} from "./pipeline-stage-recovery.ts";

const PIPELINE_ID = "pipeline-1";
const CONTEXT: PipelineContext = { cwd: "/repo" };

const FAN_OUT_DEFINITION: PipelineDefinition = {
  name: "full-review",
  stages: [
    { stageId: "intent", kind: "workflow", workflow: "intent", review: "light" },
    { stageId: "approve-intent", kind: "approval" },
    { stageId: "plan", kind: "workflow", workflow: "plan", review: "debate" },
    { stageId: "approve-plan", kind: "approval" },
    { stageId: "implement", kind: "workflow", workflow: "implement", review: "debate" },
  ],
};

const SINGLE_DEFINITION: PipelineDefinition = {
  name: "solo",
  stages: [
    { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
    { stageId: "plan", kind: "workflow", workflow: "plan", review: "debate" },
  ],
};

let rowSeq = 0;

function stageRow(
  overrides: Partial<PipelineStageRecord> & Pick<PipelineStageRecord, "stageId" | "branchKey" | "position">,
): PipelineStageRecord {
  rowSeq += 1;
  return {
    id: `row-${rowSeq}`,
    pipelineId: PIPELINE_ID,
    status: "pending",
    workflowInvocationId: null,
    startedAt: null,
    endedAt: null,
    artifact: null,
    failureDetail: null,
    decidedAt: null,
    ...overrides,
  };
}

function makePipeline(
  definition: PipelineDefinition,
  stages: PipelineStageRecord[],
  context: PipelineContext | null = CONTEXT,
): Pipeline & { stages: PipelineStageRecord[] } {
  return {
    id: PIPELINE_ID,
    name: definition.name,
    createdAt: 0,
    ownerIdentity: null,
    status: "active",
    definition,
    context,
    terminalPublicationFailure: null,
    terminalPublicationSucceededAt: null,
    dismissedAt: null,
    stages,
  };
}

function makeStore(
  pipelines: Record<string, (Pipeline & { stages: PipelineStageRecord[] }) | undefined>,
  runs: Record<string, Partial<Run>>,
): StateStore {
  return {
    loadPipeline: (id: string) => pipelines[id] ?? null,
    loadRun: (id: string) =>
      runs[id] ? ({ id, attempts: [], ...runs[id] } as unknown as Run & { attempts: [] }) : null,
  } as unknown as StateStore;
}

/** A `resolveStage` stub that ignores its arguments and returns a fixed resolution once. */
function stubResolveSteps(steps: AnyWorkflowStep[]) {
  return async () => ({ ok: true as const, steps });
}

function stubResolveFanOut(results: AnyWorkflowStep[][]) {
  return async () => ({ ok: true as const, results: results.map((steps) => ({ steps })) });
}

function stubResolveError(error: string) {
  return async () => ({ ok: false as const, error });
}

const WRITE_STEP: AnyWorkflowStep = { behavior: "write", stepId: "plan" } as unknown as AnyWorkflowStep;

function reviewDebateStep(args: { cwd: string; durablePath: string; branch?: string }): ReviewDebateWorkflowStep {
  return {
    behavior: "review-debate",
    stepId: "review-debate",
    project: "demo",
    branch: args.branch ?? "plan/branch",
    cwd: args.cwd,
    verdictPath: `${args.cwd}/.jarvis-plan-stage/verdict-plan.md`,
    maxCycles: 1,
    agents: { adversary: ["claude"], advocate: ["claude"], adjudicator: ["claude"], actuator: ["claude"] },
    agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
    landing: { kind: "plan-tree", stagingDir: ".jarvis-plan-stage", durablePath: args.durablePath },
  };
}

describe("resolveBlockedPlanStageRecoveryTarget", () => {
  test("selects the named non-first fan-out result for plan recovery", async () => {
    // @mutate v2/src/daemon/pipeline-stage-recovery.ts "resolution.results[branchIndex]?.steps" -> "resolution.results[0]?.steps"
    const branchKeys = ["branch-a", "branch-b", "branch-c"];
    const stages: PipelineStageRecord[] = [
      stageRow({
        stageId: "intent",
        branchKey: "default",
        position: 0,
        status: "succeeded",
        workflowInvocationId: "run-intent",
        artifact: {
          entryRunId: "run-intent",
          specPath: "ready-intents/index.md",
          downstreamInputs: branchKeys.map((key) => `ready-intents/${key}.md`),
        },
      }),
      ...branchKeys.flatMap((branchKey) => [
        stageRow({ stageId: "approve-intent", branchKey, position: 1, status: "approved" }),
        stageRow({
          stageId: "plan",
          branchKey,
          position: 2,
          status: branchKey === "branch-b" ? "failed" : "pending",
          workflowInvocationId: branchKey === "branch-b" ? "run-plan-b" : null,
        }),
      ]),
    ];
    const entryRun: Partial<Run> = {
      project: "demo",
      branch: "plan/branch-b",
      worktreePath: "/worktrees/demo/plan/branch-b",
      specPath: "specs/demo/plan/branch-b-plan.md",
      stepId: "plan",
    };
    const store = makeStore({ [PIPELINE_ID]: makePipeline(FAN_OUT_DEFINITION, stages) }, { "run-plan-b": entryRun });
    const writeSteps = branchKeys.map(
      (branchKey) => ({ behavior: "write", stepId: `plan-${branchKey}` }) as unknown as AnyWorkflowStep,
    );
    const reviewSteps = branchKeys.map((branchKey) =>
      reviewDebateStep({
        cwd: `/worktrees/demo/plan/${branchKey}`,
        durablePath: `/fresh/${branchKey}`,
        branch: `plan/${branchKey}`,
      }),
    );

    const result = await resolveBlockedPlanStageRecoveryTarget(
      { pipelineId: PIPELINE_ID, branchKey: "branch-b" },
      {
        store,
        resolveStage: stubResolveFanOut(
          branchKeys.map((_, index) => [writeSteps[index] as AnyWorkflowStep, reviewSteps[index] as AnyWorkflowStep]),
        ),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected an admitted recovery target");
    expect(result.target.runId).toBe("run-plan-b");
    expect(result.target.steps).toHaveLength(1);
    expect(result.target.steps[0]?.stepId).toBe("review-debate");
    expect((result.target.steps[0] as ReviewDebateWorkflowStep).branch).toBe("plan/branch-b");
    expect((result.target.steps[0] as ReviewDebateWorkflowStep).cwd).toBe(entryRun.worktreePath as string);
    expect((result.target.steps[0] as ReviewDebateWorkflowStep).landing).toMatchObject({
      kind: "plan-tree",
      durablePath: entryRun.specPath,
    });
    expect(result.target.steps).not.toContain(writeSteps[1]);
    expect(result.target.steps).not.toContain(reviewSteps[0]);
    expect(result.target.steps).not.toContain(reviewSteps[2]);
  });

  test("refuses fan-out recovery when the named branch has no paired result", async () => {
    // @mutate v2/src/daemon/pipeline-stage-recovery.ts "if (resolvedSteps === undefined) {" -> "if (false) {"
    const stages: PipelineStageRecord[] = [
      stageRow({
        stageId: "intent",
        branchKey: "default",
        position: 0,
        status: "succeeded",
        workflowInvocationId: "run-intent",
        artifact: {
          entryRunId: "run-intent",
          specPath: "ready-intents/index.md",
          downstreamInputs: ["ready-intents/branch-a.md", "ready-intents/branch-b.md", "ready-intents/branch-c.md"],
        },
      }),
      stageRow({ stageId: "approve-intent", branchKey: "branch-c", position: 1, status: "approved" }),
      stageRow({
        stageId: "plan",
        branchKey: "branch-c",
        position: 2,
        status: "failed",
        workflowInvocationId: "run-plan-c",
      }),
    ];
    const entryRun: Partial<Run> = {
      project: "demo",
      branch: "plan/branch-c",
      worktreePath: "/worktrees/demo/plan/branch-c",
      specPath: "specs/demo/plan/branch-c-plan.md",
      stepId: "plan",
    };

    const result = await resolveBlockedPlanStageRecoveryTarget(
      { pipelineId: PIPELINE_ID, branchKey: "branch-c" },
      {
        store: makeStore({ [PIPELINE_ID]: makePipeline(FAN_OUT_DEFINITION, stages) }, { "run-plan-c": entryRun }),
        resolveStage: stubResolveFanOut([[WRITE_STEP], [WRITE_STEP]]),
      },
    );

    expect(result).toEqual(expect.objectContaining({ ok: false, reason: "stage_resolution_failed" }));
    expect("target" in result).toBe(false);
  });

  test("resolves a branch blocked plan stage into a recovery request pinned to the linked run", async () => {
    // Fan-out pipeline: intent splits into branch-a/branch-b; branch-a's plan stage failed.
    const fanOutStages: PipelineStageRecord[] = [
      stageRow({
        stageId: "intent",
        branchKey: "default",
        position: 0,
        status: "succeeded",
        workflowInvocationId: "run-intent",
        artifact: {
          entryRunId: "run-intent",
          specPath: "ready-intents/index.md",
          downstreamInputs: ["ready-intents/branch-a.md", "ready-intents/branch-b.md"],
        },
      }),
      stageRow({ stageId: "approve-intent", branchKey: "default", position: 1, status: "approved" }),
      stageRow({
        stageId: "plan",
        branchKey: "branch-a",
        position: 2,
        status: "failed",
        workflowInvocationId: "run-plan-a",
      }),
    ];
    const fanOutPipeline = makePipeline(FAN_OUT_DEFINITION, fanOutStages);
    const fanOutEntryRun: Partial<Run> = {
      project: "demo",
      branch: "plan/branch-a",
      worktreePath: "/worktrees/demo/plan/branch-a",
      specPath: "specs/demo/plan/branch-a-plan.md",
      stepId: "plan",
    };
    const fanOutStore = makeStore({ [PIPELINE_ID]: fanOutPipeline }, { "run-plan-a": fanOutEntryRun });
    const staleDurablePath = "/worktrees/demo/plan/branch-a/.jarvis-plan-stage-20260817T000000Z";

    const fanOutResult = await resolveBlockedPlanStageRecoveryTarget(
      { pipelineId: PIPELINE_ID, branchKey: "branch-a" },
      {
        store: fanOutStore,
        resolveStage: stubResolveFanOut([
          [
            WRITE_STEP,
            reviewDebateStep({
              cwd: fanOutEntryRun.worktreePath as string,
              durablePath: staleDurablePath,
              branch: "plan/branch-a",
            }),
          ],
          [
            WRITE_STEP,
            reviewDebateStep({
              cwd: "/worktrees/demo/plan/branch-b",
              durablePath: "/stale/branch-b",
              branch: "plan/branch-b",
            }),
          ],
        ]),
      },
    );

    expect(fanOutResult.ok).toBe(true);
    if (!fanOutResult.ok) throw new Error("expected an admitted recovery target");
    expect(fanOutResult.target.runId).toBe("run-plan-a");
    expect(fanOutResult.target.project).toBe("demo");
    expect(fanOutResult.target.branch).toBe("plan/branch-a");
    expect(fanOutResult.target.worktreePath).toBe("/worktrees/demo/plan/branch-a");
    expect(fanOutResult.target.writeStepId).toBe("plan");
    expect(fanOutResult.target.steps).toHaveLength(1);
    const fanOutStep = fanOutResult.target.steps[0] as ReviewDebateWorkflowStep;
    expect(fanOutStep.behavior).toBe("review-debate");
    // Pinned to the linked entry run's own recorded specPath, not the freshly re-resolved timestamped path.
    expect(fanOutStep.landing?.kind).toBe("plan-tree");
    expect((fanOutStep.landing as { durablePath: string }).durablePath).toBe(fanOutEntryRun.specPath as string);
    expect((fanOutStep.landing as { durablePath: string }).durablePath).not.toBe(staleDurablePath);

    // Single-branch pipeline: the failed plan row is recorded under branchKey "default".
    const singleStages: PipelineStageRecord[] = [
      stageRow({
        stageId: "intent",
        branchKey: "default",
        position: 0,
        status: "succeeded",
        workflowInvocationId: "run-intent-solo",
        artifact: { entryRunId: "run-intent-solo", specPath: "ready-intents/solo.md" },
      }),
      stageRow({
        stageId: "plan",
        branchKey: "default",
        position: 1,
        status: "failed",
        workflowInvocationId: "run-plan-solo",
      }),
    ];
    const singlePipeline = makePipeline(SINGLE_DEFINITION, singleStages);
    const singleEntryRun: Partial<Run> = {
      project: "demo",
      branch: "plan/solo",
      worktreePath: "/worktrees/demo/plan/solo",
      specPath: "specs/demo/plan/solo-plan.md",
      stepId: "plan",
    };
    const singleStore = makeStore({ [PIPELINE_ID]: singlePipeline }, { "run-plan-solo": singleEntryRun });

    const singleResult = await resolveBlockedPlanStageRecoveryTarget(
      { pipelineId: PIPELINE_ID, branchKey: "default" },
      {
        store: singleStore,
        resolveStage: stubResolveSteps([
          WRITE_STEP,
          reviewDebateStep({
            cwd: singleEntryRun.worktreePath as string,
            durablePath: "/worktrees/demo/plan/solo/.jarvis-plan-stage-stale",
            branch: "plan/solo",
          }),
        ]),
      },
    );

    expect(singleResult.ok).toBe(true);
    if (!singleResult.ok) throw new Error("expected an admitted recovery target");
    expect(singleResult.target.runId).toBe("run-plan-solo");
    expect(singleResult.target.worktreePath).toBe("/worktrees/demo/plan/solo");
    expect(singleResult.target.steps).toHaveLength(1);
    const singleStep = singleResult.target.steps[0] as ReviewDebateWorkflowStep;
    expect((singleStep.landing as { durablePath: string }).durablePath).toBe(singleEntryRun.specPath as string);

    // Keystone checkpoint: rebinding the recovered step/landing to the raw re-resolved step
    // restores redraft-shaped output (the stale, freshly-resolved durablePath) — must go RED.
    // @mutate v2/src/daemon/pipeline-stage-recovery.ts "landing: { ...reviewStep.landing, durablePath: entryRun.specPath }," -> "landing: reviewStep.landing,"
  });

  test("resolves a review-failed plan stage through pipeline recovery", async () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "pipeline-review-failed-recover-"));
    execFileSync("git", ["init", "-q"], { cwd: worktreePath });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: worktreePath });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: worktreePath });
    execFileSync("git", ["commit", "--allow-empty", "-qm", "base"], { cwd: worktreePath });
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const durable = join(worktreePath, "spec", "2026-pipeline-review-failed");
    mkdirSync(stage, { recursive: true });
    writeFileSync(join(stage, "intent.md"), "---\nname: test\n---\n", "utf8");
    writeFileSync(join(stage, "index.md"), "# Index\n\n- [ ] [One](./00-first.md)\n", "utf8");
    writeFileSync(join(stage, "00-first.md"), "# One\n\n## Acceptance criteria\n\n- [ ] one\n", "utf8");
    const branch = "plan/pipeline-review-failed";
    const specPath = "spec/2026-pipeline-review-failed";
    const invocationId = "pipeline-review-failed-inv";
    const snapshot = {
      invocationId,
      steps: [
        { stepId: "plan", role: "plan", expectedArtifactPath: ".jarvis-plan-stage" },
        { stepId: "plan-review", role: "", behavior: "review-debate" as const },
      ],
    };
    const planReviewConfig: AgentModelConfig = {
      claude: { critic: { rungs: [{ adapterModel: "critic", priceKey: "critic" }] } },
      codex: { actuator: { rungs: [{ adapterModel: "actuator", priceKey: "actuator" }] } },
    };
    const writeInvocations: string[] = [];

    await withStateStore(async (store) => {
      const entryRunId = store.createRun({
        project: "demo",
        specRef: "HEAD",
        worktreePath,
        branch,
        specPath,
        stepId: "plan",
        workflowSnapshot: snapshot,
      });
      const writeAttempt = store.recordAttemptStart(entryRunId);
      store.commitCompletionBoundary({ attemptId: writeAttempt, runStatus: "completed", outcomeKind: "done" });

      const reviewRunId = store.createRun({
        project: "demo",
        specRef: "",
        worktreePath,
        branch,
        specPath: ".jarvis-plan-stage",
        stepId: "plan-review",
        workflowSnapshot: snapshot,
      });
      const reviewAttempt = store.recordAttemptStart(reviewRunId);
      store.commitCompletionBoundary({
        attemptId: reviewAttempt,
        runStatus: "failed",
        outcomeKind: "idle_output_timeout",
      });

      const pipelineId = store.createPipeline({ definition: SINGLE_DEFINITION, context: CONTEXT });
      store.updateStage({
        pipelineId,
        stageId: "intent",
        patch: {
          status: "succeeded",
          workflowInvocationId: "run-intent",
          artifact: { entryRunId: "run-intent", specPath: "ready-intents/solo.md" },
        },
      });
      store.updateStage({
        pipelineId,
        stageId: "plan",
        branchKey: "default",
        patch: { status: "failed", workflowInvocationId: entryRunId, failureDetail: { message: "review failed" } },
      });

      const reviewStep: ReviewWorkflowStep = {
        behavior: "review",
        stepId: "plan-review",
        project: "demo",
        branch,
        cwd: worktreePath,
        prompt: "",
        verdictPath: join(stage, "verdict-plan.md"),
        maxCycles: 1,
        agents: { critic: ["claude"], actuator: ["codex"] },
        agentModelConfig: planReviewConfig,
        profile: planReviewPromptProfile,
        profileContext: { specPath: stage, worktreePath },
        landing: { kind: "plan-tree", stagingDir: ".jarvis-plan-stage", durablePath: durable },
        createBinding: ({ agentId }) => {
          writeInvocations.push(agentId);
          return {
            id: agentId,
            metadata: { agent: agentId, model: agentId },
            invoke: async () =>
              agentId === "claude"
                ? ({ kind: "ok", stdout: "Looks good", stderr: "" } as const)
                : ({ kind: "ok", stdout: "done", stderr: "" } as const),
          };
        },
      };

      const resolution = await resolveBlockedPlanStageRecoveryTarget(
        { pipelineId, branchKey: "default" },
        {
          store,
          resolveStage: stubResolveSteps([
            { behavior: "write", stepId: "plan" } as unknown as AnyWorkflowStep,
            reviewStep,
          ]),
        },
      );

      // @mutate v2/src/daemon/pipeline-stage-recovery.ts "if (!isPlanStageEntryRunRecoverable(entryRun, store, reviewStep.stepId)) {" -> "if (false) {"
      expect(resolution.ok).toBe(true);
      if (!resolution.ok) throw new Error("expected an admitted recovery target");
      expect(resolution.target.steps).toHaveLength(1);
      expect(resolution.target.steps[0]?.behavior).toBe("review");

      const outcome = await recoverPlanStage({
        runId: resolution.target.runId,
        project: resolution.target.project,
        branch: resolution.target.branch,
        worktreePath: resolution.target.worktreePath,
        writeStepId: resolution.target.writeStepId,
        steps: resolution.target.steps,
        stateStore: store,
      });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error("unreachable");
      expect(outcome.kind).toBe("complete");
      expect(writeInvocations).toEqual(["claude", "codex"]);
      expect(existsSync(join(durable, "00-first.md"))).toBe(true);
    });
  });

  test("refuses an unresolvable pipeline or branch recovery target with a named reason", async () => {
    const stages: PipelineStageRecord[] = [
      stageRow({
        stageId: "intent",
        branchKey: "default",
        position: 0,
        status: "succeeded",
        workflowInvocationId: "run-intent",
        artifact: { entryRunId: "run-intent", specPath: "ready-intents/solo.md" },
      }),
      stageRow({
        stageId: "plan",
        branchKey: "default",
        position: 1,
        status: "failed",
        workflowInvocationId: "run-plan",
      }),
    ];
    const entryRun: Partial<Run> = {
      project: "demo",
      branch: "plan/solo",
      worktreePath: "/worktrees/demo/plan/solo",
      specPath: "specs/demo/plan/solo-plan.md",
      stepId: "plan",
    };

    // An unknown pipeline id.
    const emptyStore = makeStore({}, {});
    const unknownPipeline = await resolveBlockedPlanStageRecoveryTarget(
      { pipelineId: "no-such-pipeline", branchKey: "default" },
      { store: emptyStore },
    );
    expect(unknownPipeline).toEqual(expect.objectContaining({ ok: false, reason: "pipeline_not_found" }));
    expect("target" in unknownPipeline).toBe(false);

    // A real pipeline, but an unknown or empty branch key.
    const realPipeline = makePipeline(SINGLE_DEFINITION, stages);
    const realStore = makeStore({ [PIPELINE_ID]: realPipeline }, { "run-plan": entryRun });
    const unknownBranch = await resolveBlockedPlanStageRecoveryTarget(
      { pipelineId: PIPELINE_ID, branchKey: "no-such-branch" },
      { store: realStore },
    );
    expect(unknownBranch).toEqual(expect.objectContaining({ ok: false, reason: "branch_not_found" }));
    const emptyBranch = await resolveBlockedPlanStageRecoveryTarget(
      { pipelineId: PIPELINE_ID, branchKey: "" },
      { store: realStore },
    );
    expect(emptyBranch).toEqual(expect.objectContaining({ ok: false, reason: "branch_not_found" }));

    // An otherwise-resolvable failed branch whose pipeline context is null.
    const noContextPipeline = makePipeline(SINGLE_DEFINITION, stages, null);
    const noContextStore = makeStore({ [PIPELINE_ID]: noContextPipeline }, { "run-plan": entryRun });
    const missingContext = await resolveBlockedPlanStageRecoveryTarget(
      { pipelineId: PIPELINE_ID, branchKey: "default" },
      { store: noContextStore },
    );
    expect(missingContext).toEqual(expect.objectContaining({ ok: false, reason: "missing_context" }));

    // Mutation checkpoints: inverting each guard suppresses the refusal (and the request stays
    // absent — either the guard's `false` branch throws downstream, or it wrongly proceeds to
    // resolution/an admitted target) — must go RED.
    // @mutate v2/src/daemon/pipeline-stage-recovery.ts "if (!pipeline) {" -> "if (false) {"
    // @mutate v2/src/daemon/pipeline-stage-recovery.ts "if (!branchHasRows(pipeline, branchKey)) {" -> "if (false) {"
    // @mutate v2/src/daemon/pipeline-stage-recovery.ts "if (pipeline.context === null) {" -> "if (false) {"
  });

  test("refuses an unrecoverable stage target with a named reason", async () => {
    const entryRun: Partial<Run> = {
      project: "demo",
      branch: "plan/solo",
      worktreePath: "/worktrees/demo/plan/solo",
      specPath: "specs/demo/plan/solo-plan.md",
      stepId: "plan",
    };

    // No failed row on the branch.
    const pendingStages: PipelineStageRecord[] = [
      stageRow({ stageId: "intent", branchKey: "default", position: 0, status: "succeeded" }),
      stageRow({ stageId: "plan", branchKey: "default", position: 1, status: "pending" }),
    ];
    const noFailedResult = await resolveBlockedPlanStageRecoveryTarget(
      { pipelineId: PIPELINE_ID, branchKey: "default" },
      { store: makeStore({ [PIPELINE_ID]: makePipeline(SINGLE_DEFINITION, pendingStages) }, {}) },
    );
    expect(noFailedResult).toEqual(expect.objectContaining({ ok: false, reason: "no_failed_stage" }));

    // A failed non-plan workflow stage.
    const nonPlanStages: PipelineStageRecord[] = [
      stageRow({
        stageId: "intent",
        branchKey: "default",
        position: 0,
        status: "failed",
        workflowInvocationId: "run-intent-failed",
      }),
      stageRow({ stageId: "plan", branchKey: "default", position: 1, status: "pending" }),
    ];
    const stageNotPlanResult = await resolveBlockedPlanStageRecoveryTarget(
      { pipelineId: PIPELINE_ID, branchKey: "default" },
      {
        store: makeStore(
          { [PIPELINE_ID]: makePipeline(SINGLE_DEFINITION, nonPlanStages) },
          { "run-intent-failed": entryRun },
        ),
      },
    );
    expect(stageNotPlanResult).toEqual(expect.objectContaining({ ok: false, reason: "stage_not_plan" }));

    // A failed plan row with no workflowInvocationId.
    const unlinkedStages: PipelineStageRecord[] = [
      stageRow({ stageId: "intent", branchKey: "default", position: 0, status: "succeeded" }),
      stageRow({ stageId: "plan", branchKey: "default", position: 1, status: "failed", workflowInvocationId: null }),
    ];
    const noInvocationResult = await resolveBlockedPlanStageRecoveryTarget(
      { pipelineId: PIPELINE_ID, branchKey: "default" },
      { store: makeStore({ [PIPELINE_ID]: makePipeline(SINGLE_DEFINITION, unlinkedStages) }, {}) },
    );
    expect(noInvocationResult).toEqual(expect.objectContaining({ ok: false, reason: "stage_not_linked" }));

    // A failed plan row whose linked run row is missing.
    const missingRunStages: PipelineStageRecord[] = [
      stageRow({ stageId: "intent", branchKey: "default", position: 0, status: "succeeded" }),
      stageRow({
        stageId: "plan",
        branchKey: "default",
        position: 1,
        status: "failed",
        workflowInvocationId: "run-does-not-exist",
      }),
    ];
    const missingRunResult = await resolveBlockedPlanStageRecoveryTarget(
      { pipelineId: PIPELINE_ID, branchKey: "default" },
      { store: makeStore({ [PIPELINE_ID]: makePipeline(SINGLE_DEFINITION, missingRunStages) }, {}) },
    );
    expect(missingRunResult).toEqual(expect.objectContaining({ ok: false, reason: "stage_not_linked" }));

    // resolveStage itself reports a resolution error.
    const failedStages: PipelineStageRecord[] = [
      stageRow({ stageId: "intent", branchKey: "default", position: 0, status: "succeeded" }),
      stageRow({
        stageId: "plan",
        branchKey: "default",
        position: 1,
        status: "failed",
        workflowInvocationId: "run-plan",
      }),
    ];
    const resolutionFailedResult = await resolveBlockedPlanStageRecoveryTarget(
      { pipelineId: PIPELINE_ID, branchKey: "default" },
      {
        store: makeStore({ [PIPELINE_ID]: makePipeline(SINGLE_DEFINITION, failedStages) }, { "run-plan": entryRun }),
        resolveStage: stubResolveError("pipeline-stage-resolve: boom"),
      },
    );
    expect(resolutionFailedResult).toEqual({
      ok: false,
      reason: "stage_resolution_failed",
      message: "pipeline-stage-resolve: boom",
    });

    // A `review: "none"` plan stage: re-resolution lands only the write step, no review step.
    const noReviewResult = await resolveBlockedPlanStageRecoveryTarget(
      { pipelineId: PIPELINE_ID, branchKey: "default" },
      {
        store: makeStore({ [PIPELINE_ID]: makePipeline(SINGLE_DEFINITION, failedStages) }, { "run-plan": entryRun }),
        resolveStage: stubResolveSteps([WRITE_STEP]),
      },
    );
    expect(noReviewResult).toEqual(expect.objectContaining({ ok: false, reason: "stage_not_recoverable" }));

    // A resolved review step whose cwd differs from the linked run's worktreePath.
    const cwdMismatchResult = await resolveBlockedPlanStageRecoveryTarget(
      { pipelineId: PIPELINE_ID, branchKey: "default" },
      {
        store: makeStore({ [PIPELINE_ID]: makePipeline(SINGLE_DEFINITION, failedStages) }, { "run-plan": entryRun }),
        resolveStage: stubResolveSteps([
          WRITE_STEP,
          reviewDebateStep({ cwd: "/somewhere/else", durablePath: "/somewhere/else/.jarvis-plan-stage-stale" }),
        ]),
      },
    );
    expect(cwdMismatchResult).toEqual(expect.objectContaining({ ok: false, reason: "stage_not_recoverable" }));

    // Mutation checkpoints: inverting each guard suppresses its refusal — the request stays
    // absent because the bypassed guard's `false` branch either throws downstream on the
    // fixture's own missing data, or (resolution-error / cwd-mismatch) never reaches an
    // admitted target — must go RED.
    // @mutate v2/src/daemon/pipeline-stage-recovery.ts "if (!failed) {" -> "if (false) {"
    // @mutate v2/src/daemon/pipeline-stage-recovery.ts "if (stage.workflow !== \"plan\") {" -> "if (false) {"
    // @mutate v2/src/daemon/pipeline-stage-recovery.ts "if (entryRunId === null || entryRun === null || !entryRun.stepId) {" -> "if (false) {"
    // @mutate v2/src/daemon/pipeline-stage-recovery.ts "if (resolution.ok === false) {" -> "if (false) {"
    // @mutate v2/src/daemon/pipeline-stage-recovery.ts "if (reviewStep === undefined) {" -> "if (false) {"
    // @mutate v2/src/daemon/pipeline-stage-recovery.ts "if (reviewStep.cwd !== entryRun.worktreePath) {" -> "if (false) {"
  });
});

describe("recoverPipelineBranchStage", () => {
  const PLAN_REVIEW_CONFIG: AgentModelConfig = {
    claude: { critic: { rungs: [{ adapterModel: "critic", priceKey: "critic" }] } },
    codex: { actuator: { rungs: [{ adapterModel: "actuator", priceKey: "actuator" }] } },
  };
  const PLAN_WRITE_AGENT_MODEL_CONFIG: AgentModelConfig = {
    claude: { plan: { rungs: [{ adapterModel: "plan", priceKey: "plan" }] } },
  };
  const RECOVERY_MD_LINT_FIXTURES = join(
    import.meta.dir,
    "..",
    "execution",
    "fixtures",
    "write-loop-staged-markdown-lint",
  );
  const BRANCH_KEYS = ["branch-a", "branch-b", "branch-c"] as const;

  const harnessPlanBlocker = (reason: string) => `\n## Blocker\n\nArtifact contract check failed: ${reason}\n`;

  class RecoveryTestLogSink implements LogSink {
    events: Array<{ runId: string; event: LogEvent }> = [];
    append(runId: string, event: LogEvent): void {
      this.events.push({ runId, event });
    }
    close(): void {
      // no-op
    }
    tail(runId: string): PersistedRecord[] {
      return this.events
        .filter((e) => e.runId === runId)
        .map((e, index) => ({ runId, seq: index, ts: new Date().toISOString(), event: e.event }));
    }
  }

  function planWorktree(prefix: string): string {
    const worktree = mkdtempSync(join(tmpdir(), prefix));
    execFileSync("git", ["init", "-q"], { cwd: worktree });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: worktree });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: worktree });
    execFileSync("git", ["commit", "--allow-empty", "-qm", "base"], { cwd: worktree });
    return worktree;
  }

  function writeLintCleanPlanStage(stage: string, subspecFile: string): void {
    mkdirSync(stage, { recursive: true });
    writeFileSync(join(stage, "intent.md"), "---\nname: test\n---\n", "utf8");
    writeFileSync(join(stage, "index.md"), `# Index\n\n- [ ] [One](./${subspecFile})\n`, "utf8");
    writeFileSync(
      join(stage, subspecFile),
      readFileSync(join(RECOVERY_MD_LINT_FIXTURES, "plan-md012-clean-subspec.md"), "utf8"),
      "utf8",
    );
  }

  function seedBlockedPlanDraftRun(
    store: StateStore,
    args: {
      project: string;
      branch: string;
      worktreePath: string;
      specPath: string;
      stepId: string;
      invocationId: string;
    },
  ): string {
    const runId = store.createRun({
      project: args.project,
      specRef: "HEAD",
      worktreePath: args.worktreePath,
      branch: args.branch,
      specPath: args.specPath,
      stepId: args.stepId,
      workflowSnapshot: {
        invocationId: args.invocationId,
        steps: [{ stepId: args.stepId, role: "plan", expectedArtifactPath: ".jarvis-plan-stage" }],
      },
    });
    const attemptId = store.recordAttemptStart(runId);
    store.commitCompletionBoundary({ attemptId, runStatus: "blocked", outcomeKind: "contract_miss" });
    return runId;
  }

  function planWriteStep(
    args: { branch: string; worktreePath: string; specPath: string },
    invocations: string[],
  ): WriteWorkflowStep {
    return {
      behavior: "write",
      stepId: "plan",
      role: "plan",
      promptId: "plan.prompt.draft",
      stepRules: "Return exactly one terminal token.",
      worktree: {
        projectRoot: args.worktreePath,
        projectName: "demo",
        branchName: args.branch,
        baseRef: "HEAD",
        git: false,
        localPath: args.worktreePath,
      },
      specPath: args.specPath,
      expectedArtifactPath: ".jarvis-plan-stage",
      agents: ["claude"],
      agentModelConfig: PLAN_WRITE_AGENT_MODEL_CONFIG,
      createBinding: ({ agentId, adapterModel }) => {
        invocations.push(agentId);
        return {
          id: `${agentId}/${adapterModel}`,
          invoke: async () => ({ kind: "ok", stdout: "done", stderr: "" }),
          metadata: { agent: agentId, model: adapterModel },
        };
      },
    };
  }

  function planReviewStep(args: {
    worktreePath: string;
    stage: string;
    durable: string;
    branch: string;
  }): ReviewWorkflowStep {
    return {
      behavior: "review",
      stepId: "plan-review",
      project: "demo",
      branch: args.branch,
      cwd: args.worktreePath,
      prompt: "",
      verdictPath: join(args.stage, "verdict-plan.md"),
      maxCycles: 1,
      agents: { critic: ["claude"], actuator: ["codex"] },
      agentModelConfig: PLAN_REVIEW_CONFIG,
      profile: planReviewPromptProfile,
      profileContext: { specPath: args.stage, worktreePath: args.worktreePath },
      landing: { kind: "plan-tree", stagingDir: ".jarvis-plan-stage", durablePath: args.durable },
      createBinding: ({ agentId }) => ({
        id: agentId,
        metadata: { agent: agentId, model: agentId },
        invoke: async () => ({ kind: "ok" as const, stdout: agentId === "claude" ? "Looks good" : "done", stderr: "" }),
      }),
    };
  }

  /** Production-shaped `full-review` fan-out: intent splits into three branches, each carrying its own approve-intent/plan/approve-plan/implement rows; `targetBranchKey`'s plan row is `failed` and linked to `entryRunId`. */
  function seedFanOutPipeline(store: StateStore, args: { targetBranchKey: string; entryRunId: string }): string {
    const pipelineId = store.createPipeline({ definition: FAN_OUT_DEFINITION, context: CONTEXT });
    store.updateStage({
      pipelineId,
      stageId: "intent",
      patch: {
        status: "succeeded",
        workflowInvocationId: "run-intent",
        artifact: {
          entryRunId: "run-intent",
          specPath: "ready-intents/index.md",
          downstreamInputs: BRANCH_KEYS.map((key) => `ready-intents/${key}.md`),
        },
      },
    });
    for (const branchKey of BRANCH_KEYS) {
      store.createPipelineStageBranch({ pipelineId, stageId: "approve-intent", branchKey });
      store.createPipelineStageBranch({ pipelineId, stageId: "plan", branchKey });
      store.createPipelineStageBranch({ pipelineId, stageId: "approve-plan", branchKey });
      store.createPipelineStageBranch({ pipelineId, stageId: "implement", branchKey });
    }
    for (const stageId of ["approve-intent", "plan", "approve-plan", "implement"] as const) {
      store.updateStage({ pipelineId, stageId, branchKey: "default", patch: { status: "skipped" } });
    }
    for (const branchKey of BRANCH_KEYS) {
      store.updateStage({ pipelineId, stageId: "approve-intent", branchKey, patch: { status: "approved" } });
    }
    store.updateStage({
      pipelineId,
      stageId: "plan",
      branchKey: args.targetBranchKey,
      patch: { status: "failed", workflowInvocationId: args.entryRunId, failureDetail: { message: "blocked" } },
    });
    // Mirrors `failWorkflowStageAt`'s real cascade: a failed workflow stage skips the rest of
    // that branch's own suffix, the shape `reopenFailedPipeline` requires.
    for (const stageId of ["approve-plan", "implement"] as const) {
      store.updateStage({ pipelineId, stageId, branchKey: args.targetBranchKey, patch: { status: "skipped" } });
    }
    return pipelineId;
  }

  /** A real Git worktree carrying a blocked plan-draft run whose staged `.jarvis-plan-stage/` trips a contract miss, wired to a fan-out pipeline row. `correct: true` applies the operator's fix before recovery runs. */
  function setUpRealRecoveryFixture(
    store: StateStore,
    args: { prefix: string; targetBranchKey: string; correct: boolean },
  ): {
    pipelineId: string;
    entryRunId: string;
    stage: string;
    durable: string;
    specPath: string;
    correctedBody: string;
    dispatchCalls: AnyWorkflowStep[][];
    draftAgentInvocations: string[];
    deps: PipelineStageRecoveryExecutionDeps;
  } {
    const worktreePath = planWorktree(args.prefix);
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const specPath = `spec/2026-${args.prefix}`;
    const durable = join(worktreePath, specPath);
    const branch = `plan/${args.prefix}`;
    const reason = "`## Decisions` bullet is outside the allowed union";

    writeLintCleanPlanStage(stage, "00-first.md");
    writeFileSync(join(stage, "00-first.md"), "# Draft with an out-of-union Decisions bullet\n", "utf8");
    writeFileSync(join(stage, "intent.md"), `---\nname: test\n---\n${harnessPlanBlocker(reason)}`, "utf8");

    const entryRunId = seedBlockedPlanDraftRun(store, {
      project: "demo",
      branch,
      worktreePath,
      specPath,
      stepId: "plan",
      invocationId: `${args.prefix}-inv`,
    });
    const logSink = new RecoveryTestLogSink();
    logSink.append(entryRunId, {
      kind: "contract_miss_detail",
      attemptId: "attempt-1",
      failedContractId: "plan.decisions-shape",
      responseText: "done",
      failureReason: reason,
    });

    const correctedBody = readFileSync(join(RECOVERY_MD_LINT_FIXTURES, "plan-md012-clean-subspec.md"), "utf8");
    if (args.correct) {
      writeFileSync(join(stage, "00-first.md"), correctedBody, "utf8");
    }

    const pipelineId = seedFanOutPipeline(store, { targetBranchKey: args.targetBranchKey, entryRunId });

    const draftAgentInvocations: string[] = [];
    const dispatchCalls: AnyWorkflowStep[][] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchCalls.push(steps);
      return { ok: true, entryRunId: "unexpected-run", invocationId: "unexpected-inv" };
    };
    const wait: PipelineWorkflowWait = async () => "completed";

    const deps: PipelineStageRecoveryExecutionDeps = {
      store,
      dispatch,
      wait,
      resolveStage: async () => ({
        ok: true,
        results: BRANCH_KEYS.map((branchKey) => ({
          steps:
            branchKey === args.targetBranchKey
              ? [
                  planWriteStep({ branch, worktreePath, specPath }, draftAgentInvocations),
                  planReviewStep({ worktreePath, stage, durable, branch }),
                ]
              : [
                  { behavior: "write", stepId: `plan-${branchKey}` } as unknown as AnyWorkflowStep,
                  planReviewStep({
                    worktreePath: `${worktreePath}-${branchKey}`,
                    stage: `${stage}-${branchKey}`,
                    durable: `${durable}-${branchKey}`,
                    branch: `plan/${branchKey}`,
                  }),
                ],
        })),
      }),
      logSink,
    };

    return {
      pipelineId,
      entryRunId,
      stage,
      durable,
      specPath,
      correctedBody,
      dispatchCalls,
      draftAgentInvocations,
      deps,
    };
  }

  test("recovers a corrected non-first fan-out branch and leaves siblings unchanged", async () => {
    await withStateStore(async (store) => {
      const setup = setUpRealRecoveryFixture(store, {
        prefix: "recover-branch-keystone",
        targetBranchKey: "branch-b",
        correct: true,
      });
      const before = store.loadPipeline(setup.pipelineId);
      const siblingRowsBefore = before?.stages.filter(
        (stage) => stage.branchKey === "branch-a" || stage.branchKey === "branch-c",
      );

      const outcome = await recoverPipelineBranchStage(
        { pipelineId: setup.pipelineId, branchKey: "branch-b" },
        setup.deps,
      );

      // Keystone checkpoint: reverting the success settlement write to `failed` restores the
      // blocked dead end (row never leaves `failed`) — must go RED.
      // @mutate v2/src/daemon/pipeline-stage-recovery.ts "patch: { status: \"succeeded\", artifact: stageArtifactFromEntryRun(entryRunId, entryRun) }," -> "patch: { status: \"failed\", artifact: stageArtifactFromEntryRun(entryRunId, entryRun) },"
      expect(outcome.kind).toBe("recovered");
      expect(setup.draftAgentInvocations).toEqual([]);
      expect(setup.dispatchCalls).toEqual([]);
      expect(readFileSync(join(setup.durable, "00-first.md"), "utf8")).toBe(setup.correctedBody);
      expect(readFileSync(join(setup.durable, "intent.md"), "utf8")).not.toContain("## Blocker");

      const pipeline = store.loadPipeline(setup.pipelineId);
      const planRow = pipeline?.stages.find((s) => s.stageId === "plan" && s.branchKey === "branch-b");
      expect(planRow?.status).toBe("succeeded");
      expect(planRow?.workflowInvocationId).toBe(setup.entryRunId);
      const artifact = planRow?.artifact as { entryRunId: string; specPath: string } | null;
      expect(artifact?.entryRunId).toBe(setup.entryRunId);
      expect(artifact?.specPath).toBe(setup.specPath);
      expect(artifact !== null && "prNumber" in artifact).toBe(false);
      expect(artifact !== null && "prUrl" in artifact).toBe(false);

      // Continuation moves only branch-b's own next gate; no downstream workflow stage dispatches.
      const approvePlanRow = pipeline?.stages.find((s) => s.stageId === "approve-plan" && s.branchKey === "branch-b");
      expect(approvePlanRow?.status).toBe("awaiting");
      const implementRow = pipeline?.stages.find((s) => s.stageId === "implement" && s.branchKey === "branch-b");
      expect(implementRow?.status).toBe("pending");
      const siblingRowsAfter = pipeline?.stages.filter(
        (stage) => stage.branchKey === "branch-a" || stage.branchKey === "branch-c",
      );
      expect(siblingRowsAfter).toEqual(siblingRowsBefore);

      // Continue-only-on-success checkpoint: skipping continuation on a successful settlement
      // leaves approve-plan `pending` instead of `awaiting` — must go RED.
      // @mutate v2/src/daemon/pipeline-stage-recovery.ts "if (settlement.kind === \"recovered\") {" -> "if (false) {"
    });
  });

  test("a completion-commit failure does not settle the stage succeeded", async () => {
    await withStateStore(async (store) => {
      const worktreePath = "/fake/worktree/branch-a";
      const branch = "plan/completion-commit-failure";
      const specPath = "spec/2026-completion-commit-failure";
      const stage = join(worktreePath, ".jarvis-plan-stage");
      const durable = join(worktreePath, specPath);
      const entryRunId = seedBlockedPlanDraftRun(store, {
        project: "demo",
        branch,
        worktreePath,
        specPath,
        stepId: "plan",
        invocationId: "completion-commit-failure-inv",
      });
      const pipelineId = seedFanOutPipeline(store, { targetBranchKey: "branch-a", entryRunId });

      const dispatchCalls: AnyWorkflowStep[][] = [];
      const deps: PipelineStageRecoveryExecutionDeps = {
        store,
        dispatch: async (steps) => {
          dispatchCalls.push(steps);
          return { ok: true, entryRunId: "unexpected-run", invocationId: "unexpected-inv" };
        },
        wait: async () => "completed",
        resolveStage: async () => ({
          ok: true,
          results: BRANCH_KEYS.map(() => ({
            steps: [
              { behavior: "write", stepId: "plan" } as unknown as AnyWorkflowStep,
              planReviewStep({ worktreePath, stage, durable, branch }),
            ],
          })),
        }),
        attempt: async () => ({
          ok: true,
          kind: "completion_commit_failed",
          stepIndex: 0,
          stepId: "plan-review",
          runId: entryRunId,
          iterationsConsumed: 1,
          resumable: false,
          completionCommitError: "Uncommitted changes: spec/2026-completion-commit-failure/00-first.md",
        }),
      };

      // Mutation checkpoint: relaxing the success predicate to `outcome.ok` alone treats this
      // completion-commit failure as a success — must go RED.
      // @mutate v2/src/daemon/pipeline-stage-recovery.ts "const succeeded = outcome.ok && outcome.kind === \"complete\";" -> "const succeeded = outcome.ok;"
      const outcome = await recoverPipelineBranchStage({ pipelineId, branchKey: "branch-a" }, deps);

      expect(outcome.kind).toBe("not_recovered");
      if (outcome.kind !== "not_recovered") throw new Error("expected not_recovered");
      expect(outcome.failureDetail).toMatchObject({
        code: "completion_commit_failed",
        message: "Uncommitted changes: spec/2026-completion-commit-failure/00-first.md",
      });
      expect(dispatchCalls).toEqual([]);

      const pipeline = store.loadPipeline(pipelineId);
      const planRow = pipeline?.stages.find((s) => s.stageId === "plan" && s.branchKey === "branch-a");
      expect(planRow?.status).toBe("failed");
      expect(planRow?.workflowInvocationId).toBe(entryRunId);
      expect(planRow?.failureDetail).toMatchObject({ code: "completion_commit_failed" });

      // Still admissible for another correction attempt without a fresh resolution walk.
      const reclaim = store.claimPipelineStageAdmission({ pipelineId, stageId: "plan", branchKey: "branch-a" });
      expect(reclaim.kind).toBe("applied");
      store.releasePipelineStageAdmission({ pipelineId, stageId: "plan", branchKey: "branch-a" });
    });
  });

  test("recovery leaves sibling branch rows and approval gates byte-for-byte unchanged", async () => {
    await withStateStore(async (store) => {
      const setup = setUpRealRecoveryFixture(store, {
        prefix: "recover-branch-siblings",
        targetBranchKey: "branch-a",
        correct: true,
      });

      const before = store.loadPipeline(setup.pipelineId);
      const siblingRowsBefore = before?.stages.filter((s) => s.branchKey === "branch-b" || s.branchKey === "branch-c");

      const outcome = await recoverPipelineBranchStage(
        { pipelineId: setup.pipelineId, branchKey: "branch-a" },
        setup.deps,
      );
      expect(outcome.kind).toBe("recovered");

      const after = store.loadPipeline(setup.pipelineId);
      const siblingRowsAfter = after?.stages.filter((s) => s.branchKey === "branch-b" || s.branchKey === "branch-c");

      expect(siblingRowsAfter).toEqual(siblingRowsBefore);
      const approveIntentB = siblingRowsAfter?.find(
        (s) => s.stageId === "approve-intent" && s.branchKey === "branch-b",
      );
      const approveIntentC = siblingRowsAfter?.find(
        (s) => s.stageId === "approve-intent" && s.branchKey === "branch-c",
      );
      expect(approveIntentB?.status).toBe("approved");
      expect(approveIntentC?.status).toBe("approved");
      expect(setup.dispatchCalls).toEqual([]);
    });
  });

  test("an uncorrected staged violation settles the target stage failed and dispatches nothing", async () => {
    await withStateStore(async (store) => {
      const setup = setUpRealRecoveryFixture(store, {
        prefix: "recover-branch-uncorrected",
        targetBranchKey: "branch-a",
        correct: false,
      });

      const before = store.loadPipeline(setup.pipelineId);
      const nonTargetRowsBefore = before?.stages.filter((s) => s.branchKey !== "branch-a");

      // Mutation checkpoints: inverting either the attempt-outcome predicate or the
      // failure-settlement guard leaves the still-invalid staged tree admitted as `succeeded` —
      // must go RED.
      // @mutate v2/src/daemon/pipeline-stage-recovery.ts "const succeeded = outcome.ok && outcome.kind === \"complete\";" -> "const succeeded = true;"
      // @mutate v2/src/daemon/pipeline-stage-recovery.ts "if (!succeeded) {" -> "if (false) {"
      const outcome = await recoverPipelineBranchStage(
        { pipelineId: setup.pipelineId, branchKey: "branch-a" },
        setup.deps,
      );

      expect(outcome.kind).toBe("not_recovered");
      if (outcome.kind !== "not_recovered") throw new Error("expected not_recovered");
      expect(outcome.failureDetail).toMatchObject({ code: "plan_stage_invalid" });
      expect(setup.dispatchCalls).toEqual([]);
      expect(setup.draftAgentInvocations).toEqual([]);

      const pipeline = store.loadPipeline(setup.pipelineId);
      const planRow = pipeline?.stages.find((s) => s.stageId === "plan" && s.branchKey === "branch-a");
      expect(planRow?.status).toBe("failed");
      expect(planRow?.workflowInvocationId).toBe(setup.entryRunId);
      expect(planRow?.failureDetail).toMatchObject({ code: "plan_stage_invalid" });
      expect(planRow?.artifact).toBeNull();

      // Never reopened: the branch's own skipped suffix (cascaded from the original failure) is untouched.
      const approvePlanRow = pipeline?.stages.find((s) => s.stageId === "approve-plan" && s.branchKey === "branch-a");
      expect(approvePlanRow?.status).toBe("skipped");

      const nonTargetRowsAfter = pipeline?.stages.filter((s) => s.branchKey !== "branch-a");
      expect(nonTargetRowsAfter).toEqual(nonTargetRowsBefore);

      // Still admissible for a second recovery attempt without a fresh resolution walk.
      const reclaim = store.claimPipelineStageAdmission({
        pipelineId: setup.pipelineId,
        stageId: "plan",
        branchKey: "branch-a",
      });
      expect(reclaim.kind).toBe("applied");
      store.releasePipelineStageAdmission({ pipelineId: setup.pipelineId, stageId: "plan", branchKey: "branch-a" });
    });
  });

  test("operator blocker leaves the named fan-out branch failed", async () => {
    await withStateStore(async (store) => {
      const setup = setUpRealRecoveryFixture(store, {
        prefix: "recover-branch-operator-blocker",
        targetBranchKey: "branch-b",
        correct: true,
      });
      const before = store.loadPipeline(setup.pipelineId);
      const siblingRowsBefore = before?.stages.filter(
        (stage) => stage.branchKey === "branch-a" || stage.branchKey === "branch-c",
      );

      const outcome = await recoverPipelineBranchStage(
        { pipelineId: setup.pipelineId, branchKey: "branch-b" },
        {
          ...setup.deps,
          attempt: async () => ({
            ok: false,
            code: "operator_blocker",
            message: "staged plan carries an operator-authored blocker",
          }),
        },
      );

      expect(outcome.kind).toBe("not_recovered");
      if (outcome.kind !== "not_recovered") throw new Error("expected not_recovered");
      expect(outcome.failureDetail).toEqual({
        code: "operator_blocker",
        message: "staged plan carries an operator-authored blocker",
      });
      expect(setup.dispatchCalls).toEqual([]);
      expect(setup.draftAgentInvocations).toEqual([]);

      const pipeline = store.loadPipeline(setup.pipelineId);
      const planRow = pipeline?.stages.find((stage) => stage.stageId === "plan" && stage.branchKey === "branch-b");
      expect(planRow?.status).toBe("failed");
      expect(planRow?.workflowInvocationId).toBe(setup.entryRunId);
      expect(planRow?.failureDetail).toEqual(outcome.failureDetail);
      const siblingRowsAfter = pipeline?.stages.filter(
        (stage) => stage.branchKey === "branch-a" || stage.branchKey === "branch-c",
      );
      expect(siblingRowsAfter).toEqual(siblingRowsBefore);
    });
  });

  test("recovery refuses a stage whose admission claim is held", async () => {
    await withStateStore(async (store) => {
      const worktreePath = "/fake/worktree/branch-a";
      const branch = "plan/claim-held";
      const specPath = "spec/2026-claim-held";
      const stage = join(worktreePath, ".jarvis-plan-stage");
      const durable = join(worktreePath, specPath);
      const entryRunId = seedBlockedPlanDraftRun(store, {
        project: "demo",
        branch,
        worktreePath,
        specPath,
        stepId: "plan",
        invocationId: "claim-held-inv",
      });
      const pipelineId = seedFanOutPipeline(store, { targetBranchKey: "branch-a", entryRunId });

      const held = store.claimPipelineStageAdmission({ pipelineId, stageId: "plan", branchKey: "branch-a" });
      expect(held.kind).toBe("applied");

      const before = store.loadPipeline(pipelineId);

      const dispatchCalls: AnyWorkflowStep[][] = [];
      const deps: PipelineStageRecoveryExecutionDeps = {
        store,
        dispatch: async (steps) => {
          dispatchCalls.push(steps);
          return { ok: true, entryRunId: "unexpected-run", invocationId: "unexpected-inv" };
        },
        wait: async () => "completed",
        resolveStage: async () => ({
          ok: true,
          results: BRANCH_KEYS.map(() => ({
            steps: [
              { behavior: "write", stepId: "plan" } as unknown as AnyWorkflowStep,
              planReviewStep({ worktreePath, stage, durable, branch }),
            ],
          })),
        }),
        attempt: async () => {
          throw new Error("recovery attempt must not run while the stage admission claim is held");
        },
      };

      // Mutation checkpoint: bypassing the held-claim refusal reaches the throwing attempt seam
      // — must go RED.
      // @mutate v2/src/daemon/pipeline-stage-recovery.ts "if (claim.kind === \"refused\") {" -> "if (false) {"
      const outcome = await recoverPipelineBranchStage({ pipelineId, branchKey: "branch-a" }, deps);

      expect(outcome).toEqual({ kind: "stage_claimed", pipelineId, branchKey: "branch-a", stageId: "plan" });
      expect(dispatchCalls).toEqual([]);

      const after = store.loadPipeline(pipelineId);
      expect(after?.stages).toEqual(before?.stages);

      store.releasePipelineStageAdmission({ pipelineId, stageId: "plan", branchKey: "branch-a" });
    });
  });
});
