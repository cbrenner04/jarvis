import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { planReviewPromptProfile } from "../../../shared/prompts/review-plan.ts";
import { locateSymbolSlice } from "../../../shared/structural-test-locator.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import { lintStagedMarkdown } from "../execution/staged-markdown-lint.ts";
import {
  REVIEW_MD_LINT_FIXTURE_IDS,
  readReviewMdLintFixture,
  skipReviewWithoutHarnessMarkdownlint,
} from "../execution/workflow-runner.test-support.ts";
import type {
  AnyWorkflowStep,
  ReviewDebateWorkflowStep,
  ReviewWorkflowStep,
  WriteWorkflowStep,
} from "../execution/workflow-runner.ts";
import { recoverPlanStage } from "../execution/workflow-runner-resume.ts";
import { ensureWorkflowRunnerResumeDepsWired } from "../testing/workflow-runner-resume-wiring.ts";

ensureWorkflowRunnerResumeDepsWired();

import type { LogEvent, LogSink, PersistedRecord } from "../persistence/log-stream.ts";
import type {
  Pipeline,
  PipelineContext,
  PipelineStageRecord,
  Run,
  StateStore,
  WorkflowSnapshotStep,
} from "../persistence/state-store.ts";
import { createMinimalDispatchWriteStep, DEFAULT_AGENT_MODEL_CONFIG } from "../testing/workflow-step-fixtures.ts";
import { withStateStore } from "../testing/write-fixtures.ts";
import type { PipelineWorkflowDispatch, PipelineWorkflowWait } from "./pipeline-stage-dispatch.ts";
import {
  type PipelineStageRecoveryExecutionDeps,
  recoverPipelineBranchStage,
  resolveBlockedPlanStageRecoveryTarget,
} from "./pipeline-stage-recovery.ts";

const PIPELINE_ID = "pipeline-1";
const CONTEXT: PipelineContext = { cwd: "/repo", configPath: "/fake/.jarvis/config.json" };

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
      runs[id]
        ? ({
            id,
            attempts: [],
            status: "failed",
            workflowSnapshot: {
              invocationId: `${id}-invocation`,
              steps: [
                {
                  stepId: runs[id]?.stepId ?? "plan",
                  role: "plan",
                  expectedArtifactPath: ".jarvis-plan-stage",
                  landingInputs: { sourceRoot: "/source", paths: [], consumeFrom: "source" },
                },
                { stepId: "plan-review", role: "", behavior: "review-debate" },
              ],
            },
            ...runs[id],
          } as unknown as Run & { attempts: [] })
        : null,
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
  test("resolves a non-first fan-out plan recovery from its linked run without dispatch resolution", async () => {
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
    const result = await resolveBlockedPlanStageRecoveryTarget(
      { pipelineId: PIPELINE_ID, branchKey: "branch-b" },
      {
        store,
        resolveStage: async () => {
          throw new Error("recovery must not call the dispatch resolver");
        },
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected an admitted recovery target");
    expect(result.target.runId).toBe("run-plan-b");
    expect(result.target.recoveryLanding).toMatchObject({
      stepId: "plan-review",
      behavior: "review-debate",
      verdictPath: "/worktrees/demo/plan/branch-b/.jarvis-plan-stage/verdict-plan.md",
      landing: {
        kind: "plan-tree",
        stagingDir: ".jarvis-plan-stage",
        durablePath: entryRun.specPath,
      },
    });
  });

  test("does not consult paired dispatch results for fan-out recovery", async () => {
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
          downstreamInputs: ["ready-intents/branch-a.md", "ready-intents/branch-b.md", "ready-intents/branch-d.md"],
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
        resolveStage: stubResolveFanOut([
          [createMinimalDispatchWriteStep({ stepId: "plan-a" })],
          [createMinimalDispatchWriteStep({ stepId: "plan-b" })],
          [createMinimalDispatchWriteStep({ stepId: "plan-d" })],
        ]),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected durable recovery target");
    expect(result.target.branch).toBe("plan/branch-c");
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
            createMinimalDispatchWriteStep({ stepId: "plan" }),
            reviewDebateStep({
              cwd: fanOutEntryRun.worktreePath as string,
              durablePath: staleDurablePath,
              branch: "plan/branch-a",
            }),
          ],
          [
            createMinimalDispatchWriteStep({ stepId: "plan" }),
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
    const fanOutStep = fanOutResult.target.recoveryLanding;
    expect(fanOutStep.behavior).toBe("review-debate");
    // Pinned to the linked entry run's own recorded specPath, not the freshly re-resolved timestamped path.
    expect(fanOutStep.landing?.kind).toBe("plan-tree");
    expect(fanOutStep.landing.durablePath).toBe(fanOutEntryRun.specPath as string);
    expect(fanOutStep.landing.durablePath).not.toBe(staleDurablePath);

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
          createMinimalDispatchWriteStep({ stepId: "plan" }),
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
    expect(singleResult.target.recoveryLanding.landing.durablePath).toBe(singleEntryRun.specPath as string);

    // Keystone checkpoint: rebinding the recovered step/landing to the raw re-resolved step
    // restores redraft-shaped output (the stale, freshly-resolved durablePath) — must go RED.
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
    const readyRoot = mkdtempSync(join(tmpdir(), "pipeline-review-failed-ready-"));
    const readyIntent = join(readyRoot, "ready-intent.md");
    writeFileSync(readyIntent, "---\nname: test\n---\n", "utf8");
    const branch = "plan/pipeline-review-failed";
    const specPath = "spec/2026-pipeline-review-failed";
    const invocationId = "pipeline-review-failed-inv";
    const snapshot = {
      invocationId,
      steps: [
        {
          stepId: "plan",
          role: "plan",
          expectedArtifactPath: ".jarvis-plan-stage",
          agents: ["claude"],
          landingInputs: { sourceRoot: readyRoot, paths: [readyIntent], consumeFrom: "source" as const },
        },
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
            invoke: async () => {
              throw new Error("pipeline recovery must not dispatch a review role");
            },
          };
        },
      };

      const resolution = await resolveBlockedPlanStageRecoveryTarget(
        { pipelineId, branchKey: "default" },
        {
          store,
          resolveStage: stubResolveSteps([createMinimalDispatchWriteStep({ stepId: "plan" }), reviewStep]),
        },
      );

      expect(resolution.ok).toBe(true);
      if (!resolution.ok) throw new Error("expected an admitted recovery target");
      expect(resolution.target.recoveryLanding.behavior).toBe("review-debate");
      expect(resolution.target.recoveryLanding.landing.inputs).toEqual({
        sourceRoot: readyRoot,
        paths: [readyIntent],
        consumeFrom: "source",
      });

      const outcome = await recoverPlanStage({
        runId: resolution.target.runId,
        project: resolution.target.project,
        branch: resolution.target.branch,
        worktreePath: resolution.target.worktreePath,
        writeStepId: resolution.target.writeStepId,
        recoveryLanding: resolution.target.recoveryLanding,
        stateStore: store,
      });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error("unreachable");
      expect(outcome.kind).toBe("complete");
      expect(writeInvocations).toEqual([]);
      expect(existsSync(join(durable, "00-first.md"))).toBe(true);
      expect(existsSync(readyIntent)).toBe(false);
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

    // Recovery does not consume pipeline context.
    const noContextPipeline = makePipeline(SINGLE_DEFINITION, stages, null);
    const noContextStore = makeStore({ [PIPELINE_ID]: noContextPipeline }, { "run-plan": entryRun });
    const missingContext = await resolveBlockedPlanStageRecoveryTarget(
      { pipelineId: PIPELINE_ID, branchKey: "default" },
      { store: noContextStore },
    );
    expect(missingContext.ok).toBe(true);

    const incompleteContext = { cwd: "/repo", seed: "legacy inline seed" } as PipelineContext;
    const incompleteContextPipeline = makePipeline(SINGLE_DEFINITION, stages, incompleteContext);
    const incompleteContextStore = makeStore({ [PIPELINE_ID]: incompleteContextPipeline }, { "run-plan": entryRun });
    const incompleteContextResult = await resolveBlockedPlanStageRecoveryTarget(
      { pipelineId: PIPELINE_ID, branchKey: "default" },
      { store: incompleteContextStore },
    );
    expect(incompleteContextResult.ok).toBe(true);

    // Mutation checkpoints: inverting each guard suppresses the refusal (and the request stays
    // absent — either the guard's `false` branch throws downstream, or it wrongly proceeds to
    // resolution/an admitted target) — must go RED.
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

    // Dispatch resolution errors are outside recovery admission.
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
    expect(resolutionFailedResult.ok).toBe(true);

    // A `review: "none"` plan stage remains ineligible even if its snapshot is malformed with a review identity.
    const noReviewDefinition: PipelineDefinition = {
      ...SINGLE_DEFINITION,
      stages: SINGLE_DEFINITION.stages.map((stage) =>
        stage.kind === "workflow" && stage.workflow === "plan" ? { ...stage, review: "none" } : stage,
      ),
    };
    const noReviewResult = await resolveBlockedPlanStageRecoveryTarget(
      { pipelineId: PIPELINE_ID, branchKey: "default" },
      {
        store: makeStore({ [PIPELINE_ID]: makePipeline(noReviewDefinition, failedStages) }, { "run-plan": entryRun }),
        resolveStage: stubResolveSteps([createMinimalDispatchWriteStep({ stepId: "plan" })]),
      },
    );
    expect(noReviewResult).toEqual(expect.objectContaining({ ok: false, reason: "stage_not_recoverable" }));

    // A freshly resolved cwd is not durable recovery input.
    const cwdMismatchResult = await resolveBlockedPlanStageRecoveryTarget(
      { pipelineId: PIPELINE_ID, branchKey: "default" },
      {
        store: makeStore({ [PIPELINE_ID]: makePipeline(SINGLE_DEFINITION, failedStages) }, { "run-plan": entryRun }),
        resolveStage: stubResolveSteps([
          createMinimalDispatchWriteStep({ stepId: "plan" }),
          reviewDebateStep({ cwd: "/somewhere/else", durablePath: "/somewhere/else/.jarvis-plan-stage-stale" }),
        ]),
      },
    );
    expect(cwdMismatchResult.ok).toBe(true);

    // Mutation checkpoints: inverting each guard suppresses its refusal — the request stays
    // absent because the bypassed guard's `false` branch either throws downstream on the
    // fixture's own missing data, or (resolution-error / cwd-mismatch) never reaches an
    // admitted target — must go RED.
  });

  test("refuses incomplete durable recovery context before admission claim", async () => {
    const stages: PipelineStageRecord[] = [
      stageRow({ stageId: "intent", branchKey: "default", position: 0, status: "succeeded" }),
      stageRow({
        stageId: "plan",
        branchKey: "default",
        position: 1,
        status: "failed",
        workflowInvocationId: "run-plan",
      }),
    ];
    const validSnapshot = {
      invocationId: "run-plan-invocation",
      steps: [
        {
          stepId: "plan",
          role: "plan",
          expectedArtifactPath: ".jarvis-plan-stage",
          landingInputs: { sourceRoot: "/source", paths: ["/source/ready.md"], consumeFrom: "source" as const },
        },
        { stepId: "plan-review", role: "", behavior: "review-debate" as const },
      ],
    };
    const validRun: Partial<Run> = {
      project: "demo",
      branch: "plan/solo",
      worktreePath: "/worktrees/demo/plan/solo",
      specPath: "specs/demo/plan/solo-plan.md",
      stepId: "plan",
      workflowSnapshot: validSnapshot,
    };
    const writeSnapshot = validSnapshot.steps[0] as WorkflowSnapshotStep;
    const reviewSnapshot = validSnapshot.steps[1] as WorkflowSnapshotStep;
    const { landingInputs: _landingInputs, ...writeWithoutLandingInputs } = writeSnapshot;
    const cases: Array<{ name: string; run: Partial<Run> }> = [
      { name: "missing snapshot", run: { ...validRun, workflowSnapshot: null } },
      {
        name: "malformed snapshot",
        run: { ...validRun, workflowSnapshot: { invocationId: "", steps: [] } },
      },
      { name: "missing linked identity", run: { ...validRun, project: "" } },
      { name: "missing write identity", run: { ...validRun, stepId: null as unknown as string } },
      {
        name: "missing write snapshot",
        run: { ...validRun, workflowSnapshot: { ...validSnapshot, steps: validSnapshot.steps.slice(1) } },
      },
      {
        name: "malformed write snapshot",
        run: {
          ...validRun,
          workflowSnapshot: {
            ...validSnapshot,
            steps: [{ ...writeSnapshot, expectedArtifactPath: "elsewhere" }, reviewSnapshot],
          },
        },
      },
      {
        name: "missing review identity",
        run: { ...validRun, workflowSnapshot: { ...validSnapshot, steps: validSnapshot.steps.slice(0, 1) } },
      },
      {
        name: "malformed review identity",
        run: {
          ...validRun,
          workflowSnapshot: {
            ...validSnapshot,
            steps: [writeSnapshot, { stepId: "", role: "", behavior: "review-debate" }],
          },
        },
      },
      { name: "missing worktree path", run: { ...validRun, worktreePath: "" } },
      { name: "missing spec path", run: { ...validRun, specPath: "" } },
      {
        name: "missing landing inputs",
        run: {
          ...validRun,
          workflowSnapshot: {
            ...validSnapshot,
            steps: [writeWithoutLandingInputs, reviewSnapshot],
          },
        },
      },
      {
        name: "malformed landing inputs",
        run: {
          ...validRun,
          workflowSnapshot: {
            ...validSnapshot,
            steps: [{ ...writeSnapshot, landingInputs: { sourceRoot: "/source", paths: "ready.md" } }, reviewSnapshot],
          } as never,
        },
      },
    ];

    for (const fixture of cases) {
      let claims = 0;
      const store = makeStore({ [PIPELINE_ID]: makePipeline(SINGLE_DEFINITION, stages) }, { "run-plan": fixture.run });
      store.claimPipelineStageAdmission = () => {
        claims += 1;
        throw new Error("durable reconstruction refusal must precede admission claim");
      };
      const result = await resolveBlockedPlanStageRecoveryTarget(
        { pipelineId: PIPELINE_ID, branchKey: "default" },
        { store },
      );
      expect(result, fixture.name).toEqual(expect.objectContaining({ ok: false, reason: "stage_not_recoverable" }));
      expect(claims, fixture.name).toBe(0);
    }
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
        steps: [
          {
            stepId: args.stepId,
            role: "plan",
            expectedArtifactPath: ".jarvis-plan-stage",
            agents: ["claude"],
            landingInputs: { sourceRoot: args.worktreePath, paths: [], consumeFrom: "worktree" },
          },
          { stepId: "plan-review", role: "", behavior: "review" },
        ],
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
      store.updateStage({
        pipelineId,
        stageId,
        branchKey: "default",
        patch: { status: "skipped", skipProvenance: "terminal" },
      });
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
      store.updateStage({
        pipelineId,
        stageId,
        branchKey: args.targetBranchKey,
        patch: { status: "skipped", skipProvenance: "provisional" },
      });
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
    dispatchCalls: AnyWorkflowStep[][];
    draftAgentInvocations: string[];
    deps: PipelineStageRecoveryExecutionDeps;
  } {
    const worktreePath = planWorktree(args.prefix);
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const specPath = `spec/2026-${args.prefix}`;
    const durable = join(worktreePath, specPath);
    const branch = `plan/${args.prefix}`;
    const reason = "Plan index links unknown subspec 01-wrong.md";

    mkdirSync(stage, { recursive: true });
    writeFileSync(
      join(stage, "index.md"),
      args.correct ? "# Index\n\n- [ ] [One](./00-first.md)\n" : "# Index\n\n- [ ] [Wrong](./01-wrong.md)\n",
      "utf8",
    );
    writeFileSync(join(stage, "00-first.md"), "# Draft with a broken index link\n", "utf8");
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

    if (args.correct) {
      writeFileSync(
        join(stage, "00-first.md"),
        readReviewMdLintFixture(REVIEW_MD_LINT_FIXTURE_IDS.planMd012CleanSubspec),
        "utf8",
      );
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
                  createMinimalDispatchWriteStep({ stepId: `plan-${branchKey}` }),
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
      dispatchCalls,
      draftAgentInvocations,
      deps,
    };
  }

  test("recovers a corrected non-first fan-out branch and leaves siblings unchanged", async () => {
    if (
      skipReviewWithoutHarnessMarkdownlint(
        "recovers a corrected non-first fan-out branch and leaves siblings unchanged",
      )
    ) {
      return;
    }

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
      expect(outcome.kind).toBe("recovered");
      expect(setup.draftAgentInvocations).toEqual([]);
      expect(setup.dispatchCalls).toEqual([]);
      expect(await lintStagedMarkdown(setup.specPath, { worktreePath: dirname(setup.stage) })).toEqual({
        kind: "clean",
      });
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
              createMinimalDispatchWriteStep({ stepId: "plan" }),
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
              createMinimalDispatchWriteStep({ stepId: "plan" }),
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
      const outcome = await recoverPipelineBranchStage({ pipelineId, branchKey: "branch-a" }, deps);

      expect(outcome).toEqual({ kind: "stage_claimed", pipelineId, branchKey: "branch-a", stageId: "plan" });
      expect(dispatchCalls).toEqual([]);

      const after = store.loadPipeline(pipelineId);
      expect(after?.stages).toEqual(before?.stages);

      store.releasePipelineStageAdmission({ pipelineId, stageId: "plan", branchKey: "branch-a" });
    });
  });
});

describe("pipeline stage recovery admission structure", () => {
  const recoverySource = readFileSync(join(import.meta.dir, "pipeline-stage-recovery.ts"), "utf8");

  test("recovery admission claims before attempt and releases in finally", () => {
    const resolveAndClaim = locateSymbolSlice({
      candidates: [recoverySource],
      start: "async function resolveAndClaimRecoveryTarget",
      end: "\nasync function runClaimedRecoveryAttempt",
      searchKey: "resolveAndClaimRecoveryTarget",
    });
    expect(resolveAndClaim).toContain("claimResolvedPipelineBranchStageRecovery");
    const claimIndex = resolveAndClaim.indexOf("claimResolvedPipelineBranchStageRecovery");
    const admittedReturnIndex = resolveAndClaim.indexOf('return admission.kind === "admitted"');
    expect(claimIndex).toBeGreaterThan(-1);
    expect(admittedReturnIndex).toBeGreaterThan(claimIndex);

    const recoverPipeline = locateSymbolSlice({
      candidates: [recoverySource],
      start: "export async function recoverPipelineBranchStage",
      end: "\n/**\n * Resolves a branch's blocked plan stage",
      searchKey: "recoverPipelineBranchStage",
    });
    const resolveCallIndex = recoverPipeline.indexOf("resolveAndClaimRecoveryTarget");
    const attemptCallIndex = recoverPipeline.indexOf("runClaimedRecoveryAttempt");
    expect(resolveCallIndex).toBeGreaterThan(-1);
    expect(attemptCallIndex).toBeGreaterThan(resolveCallIndex);

    const runClaimed = locateSymbolSlice({
      candidates: [recoverySource],
      start: "async function runClaimedRecoveryAttempt",
      end: "\n/** {@link admitAndRecoverPipelineBranchStage}",
      searchKey: "runClaimedRecoveryAttempt",
    });
    const tryIndex = runClaimed.indexOf("try {");
    const finallyIndex = runClaimed.indexOf("} finally {");
    const releaseIndex = runClaimed.indexOf("releasePipelineStageAdmission");
    expect(tryIndex).toBeGreaterThan(-1);
    expect(finallyIndex).toBeGreaterThan(tryIndex);
    expect(releaseIndex).toBeGreaterThan(finallyIndex);

    // Mutation checkpoints: claim after attempt start or release outside finally must go RED.
  });
});
