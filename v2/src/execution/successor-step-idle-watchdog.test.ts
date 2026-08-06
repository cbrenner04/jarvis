import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { implementReviewPromptProfile } from "../../../shared/prompts/review-implement.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import { composeRunOperatorError } from "../daemon/run-operator-error.ts";
import type { LogEvent, LogSink } from "../persistence/log-stream.ts";
import type { Attempt, Run } from "../persistence/state-store.ts";
import { withStateStore } from "../testing/write-fixtures.ts";
import { executeReviewCycle as realExecuteReviewCycle } from "./review-cycle.ts";
import { executeReviewDebate as realExecuteReviewDebate } from "./review-debate.ts";
import { armSuccessorShellIdleWatchdog, resolveSuccessorShellIdleBoundMs } from "./successor-step-idle-watchdog.ts";
import {
  type AnyWorkflowStep,
  executeWorkflow,
  type ReviewDebateWorkflowStep,
  type ReviewWorkflowStep,
} from "./workflow-runner.ts";

class TestLogSink implements LogSink {
  events: Array<{ runId: string; event: LogEvent }> = [];

  append(runId: string, event: LogEvent): void {
    this.events.push({ runId, event });
  }

  close(): void {}

  getEventsForRun(runId: string): LogEvent[] {
    return this.events.filter((entry) => entry.runId === runId).map((entry) => entry.event);
  }
}

const REVIEW_AGENT_MODEL_CONFIG: AgentModelConfig = {
  claude: {
    critic: { rungs: [{ adapterModel: "CRIT", priceKey: "p-crit" }] },
    actuator: { rungs: [{ adapterModel: "ACT", priceKey: "p-act" }] },
  },
};

const DEBATE_AGENT_MODEL_CONFIG: AgentModelConfig = {
  claude: {
    adversary: { rungs: [{ adapterModel: "ADV", priceKey: "p-adv" }] },
    advocate: { rungs: [{ adapterModel: "ADVOC", priceKey: "p-advoc" }] },
    adjudicator: { rungs: [{ adapterModel: "ADJ", priceKey: "p-adj" }] },
    actuator: { rungs: [{ adapterModel: "ACT", priceKey: "p-act" }] },
  },
};

const SHORT_IDLE_MS = 20;
const HARNESS_BUDGET_MS = 200;

function stageReviewedIntent(workspace: string): void {
  const stage = join(workspace, ".jarvis-intent-stage");
  mkdirSync(stage, { recursive: true });
  writeFileSync(join(stage, "example.md"), "---\nname: example\n---\n\n## Prerequisites\n", "utf8");
}

function createDurableReviewStep(workspace: string, idleOutputMs: number = SHORT_IDLE_MS): ReviewWorkflowStep {
  return {
    behavior: "review",
    stepId: "review",
    project: "demo",
    branch: "intent/shell-stall",
    cwd: workspace,
    prompt: "inspect",
    verdictPath: join(workspace, ".jarvis-intent-review-verdict.md"),
    maxCycles: 1,
    agents: { critic: ["claude"], actuator: ["claude"] },
    agentModelConfig: REVIEW_AGENT_MODEL_CONFIG,
    idleOutputMs,
    landing: {
      kind: "intent-stage",
      output: { durableDir: "ready-intents" },
      stagingDir: join(workspace, ".jarvis-intent-stage"),
      invocationId: "invocation-shell-stall",
      baseRef: "none",
    },
    createBinding: ({ agentId }) => ({
      id: agentId,
      metadata: { agent: agentId, model: agentId },
      invoke: async () => ({ kind: "ok" as const, stdout: "apply", stderr: "" }),
    }),
  };
}

function createReviewDebateStep(workspace: string, idleOutputMs: number = SHORT_IDLE_MS): ReviewDebateWorkflowStep {
  return {
    behavior: "review-debate",
    stepId: "implement-review",
    project: "demo",
    branch: "implement/shell-stall",
    cwd: workspace,
    prompts: { adversary: "adv", advocate: "advoc", adjudicator: "adj" },
    verdictPath: join(workspace, "verdict-patch.md"),
    maxCycles: 1,
    agents: { adversary: ["claude"], advocate: ["claude"], adjudicator: ["claude"], actuator: ["claude"] },
    agentModelConfig: DEBATE_AGENT_MODEL_CONFIG,
    profile: implementReviewPromptProfile,
    profileContext: { specPath: "index.md", cwd: workspace, baseBranch: "HEAD", passNumber: 1, totalPasses: 1 },
    idleOutputMs,
    createBinding: ({ agentId, adapterModel }) => ({
      id: `${agentId}/${adapterModel}`,
      metadata: { agent: agentId, model: adapterModel },
      invoke: async () => ({ kind: "ok" as const, stdout: "ok", stderr: "" }),
    }),
  };
}

function assertRoleStalledProjection(
  run: (Run & { attempts: Attempt[] }) | null,
  events: LogEvent[],
  boundMs: number,
): void {
  expect(run?.status).toBe("failed");
  const detail = run?.attempts.at(-1)?.invocationFailureDetail;
  expect(detail).toMatchObject({ failureKind: "stall", boundMs, bindingAttempts: [] });
  expect(detail?.agent).toBeUndefined();
  expect(detail?.model).toBeUndefined();
  expect(events.at(-1)).toMatchObject({
    kind: "loop_finished",
    loopOutcomeKind: "invocation_failure",
    resumable: true,
  });
  const terminal = events.at(-1);
  if (terminal?.kind === "loop_finished" && run !== null) {
    expect(composeRunOperatorError(run, { runId: run.id, seq: 1, ts: "", event: terminal })).toMatchObject({
      reason: "role_stalled",
      retryable: true,
      nextAction: "retry_later",
    });
  }
}

async function assertSilentSuccessorSettles(step: AnyWorkflowStep): Promise<void> {
  const logSink = new TestLogSink();
  const startedAt = Date.now();

  await withStateStore(async (store) => {
    const result = await executeWorkflow({ steps: [step], stateStore: store, logSink });
    expect(Date.now() - startedAt).toBeLessThan(HARNESS_BUDGET_MS);
    expect(result).toMatchObject({
      kind: "invocation_failure",
      resumable: true,
      stepId: step.stepId,
    });

    const run = store.loadRun(result.runId);
    const events = logSink.getEventsForRun(result.runId);
    expect(events[0]).toMatchObject({ kind: "iteration_started" });
    assertRoleStalledProjection(run, events, SHORT_IDLE_MS);
  });
}

describe("successor shell idle watchdog", () => {
  test("resolveSuccessorShellIdleBoundMs uses review-role semantics", () => {
    expect(resolveSuccessorShellIdleBoundMs(undefined)).toBe(90_000);
    expect(resolveSuccessorShellIdleBoundMs(0)).toBeUndefined();
    expect(resolveSuccessorShellIdleBoundMs(SHORT_IDLE_MS)).toBe(SHORT_IDLE_MS);
  });

  test("armSuccessorShellIdleWatchdog disarms before the bound elapses", async () => {
    const watchdog = armSuccessorShellIdleWatchdog({ idleOutputMs: 1, onStall: () => {} });
    expect(watchdog).toBeDefined();
    watchdog?.disarm();
    await expect(watchdog?.stalled).resolves.toBe(false);
  });
});

describe("successor-step-idle-watchdog workflow integration", () => {
  afterEach(() => {
    mock.module("./review-cycle.ts", () => ({ executeReviewCycle: realExecuteReviewCycle }));
    mock.module("./review-debate.ts", () => ({ executeReviewDebate: realExecuteReviewDebate }));
  });

  test("a silent durable review settles within the idle budget after iteration_started", async () => {
    mock.module("./review-cycle.ts", () => ({ executeReviewCycle: () => new Promise(() => {}) }));
    const workspace = mkdtempSync(join(tmpdir(), "successor-shell-review-"));
    stageReviewedIntent(workspace);
    await assertSilentSuccessorSettles(createDurableReviewStep(workspace));
  });

  test("a silent review-debate successor settles within the idle budget after iteration_started", async () => {
    mock.module("./review-debate.ts", () => ({ executeReviewDebate: () => new Promise(() => {}) }));
    const workspace = mkdtempSync(join(tmpdir(), "successor-shell-debate-"));
    await assertSilentSuccessorSettles(createReviewDebateStep(workspace));
  });

  test("a silent actuator-only review-debate retry settles within the idle budget after iteration_started", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "successor-shell-actuator-retry-"));
    const branch = "implement/shell-stall-actuator-retry";
    const verdictPath = join(workspace, "verdict-patch.md");
    writeFileSync(verdictPath, "apply this fix\n", "utf8");

    const originalActuator = implementReviewPromptProfile.render.actuator;
    implementReviewPromptProfile.render.actuator = async () => new Promise<string>(() => {});
    try {
      await withStateStore(async (store) => {
        const runId = store.createRun({
          project: "demo",
          specRef: "",
          worktreePath: workspace,
          branch,
          specPath: verdictPath,
          stepId: "implement-review",
        });
        const attemptId = store.recordAttemptStart(runId);
        store.commitCompletionBoundary({
          attemptId,
          runStatus: "failed",
          outcomeKind: "invocation_failure",
          invocationFailureDetail: {
            failureKind: "stall",
            role: "actuator",
            bindingAttempts: [],
          },
        });

        const logSink = new TestLogSink();
        const step: ReviewDebateWorkflowStep = {
          ...createReviewDebateStep(workspace, SHORT_IDLE_MS),
          branch,
          verdictPath,
        };
        const startedAt = Date.now();
        const result = await executeWorkflow({ steps: [step], stateStore: store, logSink });
        expect(Date.now() - startedAt).toBeLessThan(HARNESS_BUDGET_MS);
        expect(result).toMatchObject({
          kind: "invocation_failure",
          resumable: true,
          stepId: "implement-review",
          runId,
        });

        const run = store.loadRun(runId);
        const events = logSink.getEventsForRun(runId);
        expect(events.at(-2)).toMatchObject({ kind: "iteration_started" });
        assertRoleStalledProjection(run, events, SHORT_IDLE_MS);
      });
    } finally {
      implementReviewPromptProfile.render.actuator = originalActuator;
    }
  });

  // @mutate v2/src/execution/workflow-runner.ts "const shellIdleWatchdog = armSuccessorShellIdleWatchdog" -> "const shellIdleWatchdog = undefined; void armSuccessorShellIdleWatchdog"
  test("pinning: shell idle arming settles a silent durable review within the idle budget", async () => {
    mock.module("./review-cycle.ts", () => ({ executeReviewCycle: () => new Promise(() => {}) }));
    const workspace = mkdtempSync(join(tmpdir(), "successor-shell-pin-"));
    stageReviewedIntent(workspace);

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [createDurableReviewStep(workspace)], stateStore: store });
      expect(store.loadRun(result.runId)?.status).toBe("failed");
      expect(result.kind).toBe("invocation_failure");
    });
  });

  test("idleOutputMs 0 disables shell idle arming for a silent durable review", async () => {
    mock.module("./review-cycle.ts", () => ({ executeReviewCycle: () => new Promise(() => {}) }));
    const workspace = mkdtempSync(join(tmpdir(), "successor-shell-disabled-"));
    stageReviewedIntent(workspace);

    await withStateStore(async (store) => {
      void executeWorkflow({ steps: [createDurableReviewStep(workspace, 0)], stateStore: store });
      const deadline = Date.now() + HARNESS_BUDGET_MS;
      while (Date.now() < deadline) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      const runId = store.findRunByProjectBranch({
        project: "demo",
        branch: "intent/shell-stall",
        stepId: "review",
      })?.id;
      expect(runId).toBeTruthy();
      expect(store.loadRun(runId as string)?.status).toBe("in-progress");
    });
  });
});
