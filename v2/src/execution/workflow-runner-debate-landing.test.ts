import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvocationResult } from "../../../shared/invocation/execute.ts";
import { withStateStore } from "../testing/write-fixtures.ts";
import { createCompletionCommitter } from "./completion-commit.ts";
import {
  createDebateBindingFactory,
  createDebateStep,
  createPatchReviewDebateStep,
  createShrinkTestStep,
  createTrackedReviewDebateBindingFactory,
  TestLogSink,
} from "./workflow-runner.test-support.ts";
import { executeWorkflow, type ReviewDebateWorkflowStep } from "./workflow-runner.ts";

describe("executeWorkflow review-debate landing", () => {
  function debateIntentStep(
    workspace: string,
    branch: string,
    overrides: Partial<Omit<ReviewDebateWorkflowStep, "behavior">> = {},
  ): ReviewDebateWorkflowStep {
    return createDebateStep({
      stepId: "review",
      branch,
      cwd: workspace,
      verdictPath: join(workspace, ".jarvis-intent-review-verdict.md"),
      landing: {
        kind: "intent-stage",
        output: { durableDir: join(workspace, "ready-intents") },
        stagingDir: join(workspace, ".jarvis-intent-stage"),
        invocationId: "invocation-debate",
        baseRef: "none",
      },
      createBinding: createDebateBindingFactory(
        async ({ adapterModel }) =>
          ({ kind: "ok", stdout: adapterModel === "ADJ" ? "apply this fix" : "ok", stderr: "" }) as const,
      ),
      ...overrides,
    });
  }

  test("promotes, cleans up, and traces a debate-last intent workflow the same as light review", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "reviewed-intent-debate-"));
    const stage = join(workspace, ".jarvis-intent-stage");
    mkdirSync(stage, { recursive: true });
    writeFileSync(join(stage, "example.md"), "---\nname: example\n---\n\n# Example\n\n## Prerequisites\n", "utf8");
    const durableDir = join(workspace, "ready-intents");
    const verdictPath = join(workspace, ".jarvis-intent-review-verdict.md");
    const step = debateIntentStep(workspace, "intent/debate-example");

    const logSink = new TestLogSink();
    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store, logSink });
      expect(result).toMatchObject({ kind: "complete" });
      const finalizationEvents = logSink
        .getEventsForRun(result.runId)
        .filter((event) => event.kind === "intent_finalization");
      expect(finalizationEvents.length).toBeGreaterThan(0);
      expect(finalizationEvents[0]).toMatchObject({ phase: "review_landing", branch: "intent/debate-example" });
    });

    expect(readFileSync(join(durableDir, "example.md"), "utf8")).toContain("# Example");
    expect(existsSync(stage)).toBe(false);
    expect(existsSync(verdictPath)).toBe(false);
    expect(existsSync(`${verdictPath}.owner`)).toBe(false);
  });

  test("settles a debate-last intent workflow's landing failure the same as light review, with a trace", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "reviewed-intent-debate-fail-"));
    const stage = join(workspace, ".jarvis-intent-stage");
    mkdirSync(stage, { recursive: true });
    writeFileSync(join(stage, "example.md"), "---\nname: example\n---\n\n# Example\n\n## Prerequisites\n", "utf8");
    const durableDir = join(workspace, "ready-intents");
    mkdirSync(durableDir, { recursive: true });
    writeFileSync(join(durableDir, "example.md"), "different\n", "utf8");
    const step = debateIntentStep(workspace, "intent/debate-collision");

    const logSink = new TestLogSink();
    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store, logSink });
      expect(result).toMatchObject({ kind: "invocation_failure", resumable: true });
      const finalizationEvents = logSink
        .getEventsForRun(result.runId)
        .filter((event) => event.kind === "intent_finalization");
      expect(finalizationEvents.length).toBeGreaterThan(0);
      expect((finalizationEvents.at(-1) as { stopReason?: string }).stopReason).toBeTruthy();
    });
    expect(existsSync(join(stage, "example.md"))).toBe(true);
  });

  test("propagates review idleOutputMs through actuator-only debate retry", async () => {
    const captured = new Map<number, number[]>();

    for (const idleOutputMs of [12_345, 0]) {
      const branchName = `implement-review-idle-retry-${idleOutputMs}`;
      const { harness, step: implementStep } = createShrinkTestStep(branchName, async ({ cwd, shrink }) => {
        if (!shrink) writeFileSync(join(cwd, "proof.txt"), "implemented\n", "utf8");
        return { kind: "ok", stdout: "done", stderr: "" };
      });
      const calls: string[] = [];
      const retryIdleOutputMs: number[] = [];
      let retried = false;
      const reviewStep = createPatchReviewDebateStep({
        branchName,
        verdictPath: join(harness.workspace, "verdict-patch.md"),
        cwd: harness.workspace,
        idleOutputMs,
        createBinding: ({ agentId, adapterModel }) => ({
          id: `${agentId}/${adapterModel}`,
          metadata: { agent: agentId, model: adapterModel },
          invoke: async ({ idleOutputMs: observedIdleOutputMs }) => {
            calls.push(adapterModel);
            if (retried) retryIdleOutputMs.push(observedIdleOutputMs ?? -1);
            if (adapterModel !== "ACT") {
              return {
                kind: "ok",
                stdout: adapterModel === "ADJ" ? "apply this fix" : "ok",
                stderr: "",
              } as const;
            }
            return { kind: "stall", stderr: "no output" } as const;
          },
        }),
      });

      await withStateStore(async (store) => {
        await executeWorkflow({
          steps: [implementStep, reviewStep],
          stateStore: store,
          completionCommitter: createCompletionCommitter(),
          completionPublisher: async () => ({}),
          readyFinalizer: async () => {},
        });
        calls.length = 0;
        retried = true;
        await executeWorkflow({
          steps: [implementStep, reviewStep],
          stateStore: store,
          completionCommitter: createCompletionCommitter(),
          completionPublisher: async () => ({}),
          readyFinalizer: async () => {},
        });
      });

      expect(calls).toEqual(["ACT"]);
      captured.set(idleOutputMs, retryIdleOutputMs);
    }

    expect(captured).toEqual(
      new Map([
        [12_345, [12_345]],
        [0, [0]],
      ]),
    );
  });

  test("exhausted review-debate actuator timeout is not actuator-only-retry eligible; re-dispatch replays the full debate on a fresh row", async () => {
    const branchName = "implement-review-timeout-not-actuator-only";
    const writeCalls: string[] = [];
    const { harness, step: implementStep } = createShrinkTestStep(branchName, async ({ cwd, shrink }) => {
      writeCalls.push(shrink ? "shrink" : "implement");
      if (!shrink) writeFileSync(join(cwd, "proof.txt"), "implemented\n", "utf8");
      return { kind: "ok", stdout: "done", stderr: "" };
    });
    const worktreePath = harness.workspace;
    const boundMs = 5;
    const debateCalls: string[] = [];
    const reviewStep = createPatchReviewDebateStep({
      branchName,
      verdictPath: join(worktreePath, "verdict-patch.md"),
      cwd: worktreePath,
      roleTimeoutMs: boundMs,
      createBinding: createTrackedReviewDebateBindingFactory(debateCalls, "timeout"),
    });

    await withStateStore(async (store) => {
      const firstResult = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: createCompletionCommitter(),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });
      expect(firstResult).toMatchObject({ kind: "invocation_failure", stepIndex: 1, resumable: false });

      const firstReviewRun = store.findRunByProjectBranch({
        project: "demo",
        branch: branchName,
        stepId: "implement-review",
      });

      writeCalls.length = 0;
      debateCalls.length = 0;

      const secondResult = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: createCompletionCommitter(),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(secondResult).toMatchObject({ kind: "invocation_failure", stepIndex: 1, resumable: false });
      // Not actuator-only: the full debate chain replays, not just the actuator.
      expect(debateCalls).toEqual(["ADV", "ADVOC", "ADJ", "ACT"]);

      const secondReviewRun = store.findRunByProjectBranch({
        project: "demo",
        branch: branchName,
        stepId: "implement-review",
      });
      expect(secondReviewRun?.id).not.toBe(firstReviewRun?.id);
    });
  });

  test("re-dispatching after a debate-role failure replays the full debate, not actuator-only", async () => {
    const branchName = "implement-review-adversary-timeout-redispatch";
    const { harness, step: implementStep } = createShrinkTestStep(branchName, async ({ cwd, shrink }) => {
      if (!shrink) writeFileSync(join(cwd, "proof.txt"), "implemented\n", "utf8");
      return { kind: "ok", stdout: "done", stderr: "" };
    });
    const worktreePath = harness.workspace;
    const boundMs = 5;
    const debateCalls: string[] = [];
    const reviewStep = createPatchReviewDebateStep({
      branchName,
      verdictPath: join(worktreePath, "verdict-patch.md"),
      cwd: worktreePath,
      roleTimeoutMs: boundMs,
      createBinding: ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
        metadata: { agent: agentId, model: adapterModel },
        invoke: ({ signal }) => {
          debateCalls.push(adapterModel);
          if (adapterModel !== "ADV") {
            return Promise.resolve(
              adapterModel === "ADJ"
                ? ({ kind: "ok", stdout: "apply this fix", stderr: "" } as const)
                : ({ kind: "ok", stdout: "ok", stderr: "" } as const),
            );
          }
          return new Promise<InvocationResult>((resolve) => {
            signal?.addEventListener("abort", () => resolve({ kind: "error", exitCode: 1, stderr: "aborted" }), {
              once: true,
            });
          });
        },
      }),
    });

    await withStateStore(async (store) => {
      const firstResult = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: createCompletionCommitter(),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });
      expect(firstResult).toMatchObject({ kind: "invocation_failure", stepIndex: 1, resumable: false });
      expect(debateCalls).toEqual(["ADV"]);
      expect(store.loadRun(firstResult.runId)?.attempts.at(-1)?.invocationFailureDetail?.role).not.toBe("actuator");

      debateCalls.length = 0;
      const secondResult = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: createCompletionCommitter(),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(secondResult).toMatchObject({ kind: "invocation_failure", stepIndex: 1, resumable: false });
      // Debate-role failures are not actuator-only eligible; the full debate replays.
      expect(debateCalls).toEqual(["ADV"]);
      // Distinguishing property from the actuator-only path: a fresh run row per re-dispatch.
      expect(secondResult.runId).not.toBe(firstResult.runId);
    });
  });

  test("multi-cycle review never takes actuator-only admission, even on a last-cycle actuator failure", async () => {
    const branchName = "implement-review-multi-cycle-actuator-timeout";
    const { harness, step: implementStep } = createShrinkTestStep(branchName, async ({ cwd, shrink }) => {
      if (!shrink) writeFileSync(join(cwd, "proof.txt"), "implemented\n", "utf8");
      return { kind: "ok", stdout: "done", stderr: "" };
    });
    const worktreePath = harness.workspace;
    const boundMs = 5;
    const debateCalls: string[] = [];
    const reviewStep = createPatchReviewDebateStep({
      branchName,
      verdictPath: join(worktreePath, "verdict-patch.md"),
      cwd: worktreePath,
      roleTimeoutMs: boundMs,
      maxCycles: 2,
      createBinding: createTrackedReviewDebateBindingFactory(debateCalls, "timeout"),
    });

    await withStateStore(async (store) => {
      const firstResult = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: createCompletionCommitter(),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });
      expect(firstResult).toMatchObject({ kind: "invocation_failure", stepIndex: 1, resumable: false });
      expect(debateCalls).toEqual(["ADV", "ADVOC", "ADJ", "ACT"]);
      expect(store.loadRun(firstResult.runId)?.attempts.at(-1)?.invocationFailureDetail).toMatchObject({
        role: "actuator",
        failureKind: "timeout",
      });

      debateCalls.length = 0;
      const secondResult = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: createCompletionCommitter(),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(secondResult).toMatchObject({ kind: "invocation_failure", stepIndex: 1, resumable: false });
      // maxCycles > 1 rules out actuator-only admission; the full debate replays on a fresh row.
      expect(debateCalls).toEqual(["ADV", "ADVOC", "ADJ", "ACT"]);
      expect(secondResult.runId).not.toBe(firstResult.runId);
    });
  });
});
