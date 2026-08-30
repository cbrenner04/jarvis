import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exitCodeForWriteResult } from "../cli/run-completion.ts";
import { composeRunOperatorError, findTerminalLogRecord } from "../daemon/run-operator-error.ts";
import { openLogReader, openLogSink } from "../persistence/log-stream.ts";
import { openStateStore } from "../persistence/state-store.ts";
import { createFakeWithExternalWorktree, createJarvisHome, withStateStore } from "../testing/write-fixtures.ts";
import { createCompletionPublisher } from "./completion-publisher.ts";
import { baseRefProbeFailsSeam, gateFailureOutput, initGateScopeWorktree } from "./ready-finalize.test.ts";
import {
  formatReadyGateOutOfScopeDetail,
  ReadyFlipError,
  ReadyGateError,
  SurvivingMutationError,
} from "./ready-finalize.ts";
import { nonEmptyDiscoveryReason } from "./runtime-smoke-verifier.ts";
import {
  createBindingFactory,
  createImplementBodySummaryStep,
  createIntentWorktreeHarness,
  createStep,
  DEFAULT_AGENT_MODEL_CONFIG,
  doneBindingFactory,
  externalWorktreeBinding,
  initGitWorkspace,
  okTokenBindingFactory,
  roots,
  seedCompletedWriteRun,
  seedLandedIntentFiles,
  TestLogSink,
} from "./workflow-runner.test-support.ts";
import { executeWorkflow, type ReviewWorkflowStep, type WriteWorkflowStep } from "./workflow-runner.ts";

describe("executeWorkflow fresh dispatch", () => {
  test("creates a new run row for a completed step when freshDispatch is set", async () => {
    const stateDbPath = ":memory:";
    const store = openStateStore(stateDbPath);

    try {
      // First invocation: complete step 1
      const step1First = createStep({ stepId: "step-1", role: "implement", branchName: "fresh-dispatch-test" });

      const result1 = await executeWorkflow({
        steps: [step1First],
        stateStore: store,
      });

      expect(result1.kind).toBe("complete");
      expect(result1.stepId).toBe("step-1");

      const run1First = store.findRunByProjectBranch({
        project: "demo",
        branch: "fresh-dispatch-test",
        stepId: "step-1",
      });
      const runId1First = run1First?.id;

      // Second invocation without freshDispatch: should reuse the completed run
      const step1Second = createStep({ stepId: "step-1", role: "implement", branchName: "fresh-dispatch-test" });

      const result2 = await executeWorkflow({
        steps: [step1Second],
        stateStore: store,
      });

      expect(result2.kind).toBe("complete");
      const run1Second = store.findRunByProjectBranch({
        project: "demo",
        branch: "fresh-dispatch-test",
        stepId: "step-1",
      });
      expect(run1Second?.id).toBe(runId1First); // Same run

      // Third invocation with freshDispatch: should create a new run
      const step1Third = createStep({ stepId: "step-1", role: "implement", branchName: "fresh-dispatch-test" });

      const result3 = await executeWorkflow({
        steps: [step1Third],
        stateStore: store,
        freshDispatch: true,
      });

      expect(result3.kind).toBe("complete");
      const run1Third = store.findRunByProjectBranch({
        project: "demo",
        branch: "fresh-dispatch-test",
        stepId: "step-1",
      });
      expect(run1Third?.id).not.toBe(runId1First); // Different run
      expect(run1Third?.attempts).toHaveLength(1); // One attempt in the new run
    } finally {
      store.close();
    }
  });

  test("creates new run rows for both steps in a two-step preset when freshDispatch is set", async () => {
    const stateDbPath = ":memory:";
    const store = openStateStore(stateDbPath);

    try {
      // First invocation: complete both steps
      const step1First = createStep({ stepId: "step-1", role: "implement", branchName: "fresh-dispatch-preset" });
      const step2First = createStep({ stepId: "step-2", role: "implement", branchName: "fresh-dispatch-preset" });

      const result1 = await executeWorkflow({
        steps: [step1First, step2First],
        stateStore: store,
      });

      expect(result1.kind).toBe("complete");

      const run1First = store.findRunByProjectBranch({
        project: "demo",
        branch: "fresh-dispatch-preset",
        stepId: "step-1",
      });
      const run2First = store.findRunByProjectBranch({
        project: "demo",
        branch: "fresh-dispatch-preset",
        stepId: "step-2",
      });
      const runId1First = run1First?.id;
      const runId2First = run2First?.id;
      const invocationId1First = run1First?.workflowSnapshot?.invocationId;

      // Second invocation with freshDispatch: should create new runs for both steps
      const step1Second = createStep({ stepId: "step-1", role: "implement", branchName: "fresh-dispatch-preset" });
      const step2Second = createStep({ stepId: "step-2", role: "implement", branchName: "fresh-dispatch-preset" });

      const result2 = await executeWorkflow({
        steps: [step1Second, step2Second],
        stateStore: store,
        freshDispatch: true,
      });

      expect(result2.kind).toBe("complete");

      const run1Second = store.findRunByProjectBranch({
        project: "demo",
        branch: "fresh-dispatch-preset",
        stepId: "step-1",
      });
      const run2Second = store.findRunByProjectBranch({
        project: "demo",
        branch: "fresh-dispatch-preset",
        stepId: "step-2",
      });
      expect(run1Second?.id).not.toBe(runId1First); // Step 1 new run
      expect(run2Second?.id).not.toBe(runId2First); // Step 2 new run
      expect(run1Second?.workflowSnapshot?.invocationId).not.toBe(invocationId1First); // New invocationId
      expect(run1Second?.workflowSnapshot?.invocationId).toBe(run2Second?.workflowSnapshot?.invocationId); // Same invocationId for both
    } finally {
      store.close();
    }
  });

  test("reuses run rows within the same execution when freshDispatch is set (shrink step)", async () => {
    const stateDbPath = ":memory:";
    const store = openStateStore(stateDbPath);

    try {
      // First invocation: complete implement step with shrink
      const step1First = createStep({
        stepId: "step-1",
        role: "implement",
        branchName: "fresh-dispatch-shrink",
        suppressShrink: false,
      });

      const result1 = await executeWorkflow({
        steps: [step1First],
        stateStore: store,
      });

      expect(result1.kind).toBe("complete");

      const run1First = store.findRunByProjectBranch({
        project: "demo",
        branch: "fresh-dispatch-shrink",
        stepId: "step-1",
      });
      const runShrinkFirst = store.findRunByProjectBranch({
        project: "demo",
        branch: "fresh-dispatch-shrink",
        stepId: "step-1~shrink",
      });
      const runId1First = run1First?.id;
      const runIdShrinkFirst = runShrinkFirst?.id;

      // Second invocation with freshDispatch: should create new run but reuse shrink run within this execution
      const step1Second = createStep({
        stepId: "step-1",
        role: "implement",
        branchName: "fresh-dispatch-shrink",
        suppressShrink: false,
      });

      const result2 = await executeWorkflow({
        steps: [step1Second],
        stateStore: store,
        freshDispatch: true,
      });

      expect(result2.kind).toBe("complete");

      const run1Second = store.findRunByProjectBranch({
        project: "demo",
        branch: "fresh-dispatch-shrink",
        stepId: "step-1",
      });
      const runShrinkSecond = store.findRunByProjectBranch({
        project: "demo",
        branch: "fresh-dispatch-shrink",
        stepId: "step-1~shrink",
      });
      expect(run1Second?.id).not.toBe(runId1First); // Implement step has new run
      expect(runShrinkSecond?.id).not.toBe(runIdShrinkFirst); // Shrink step also has new run (created within same execution)
    } finally {
      store.close();
    }
  });

  test("mints a new invocationId when freshDispatch is set", async () => {
    const stateDbPath = ":memory:";
    const store = openStateStore(stateDbPath);

    try {
      // First invocation
      const step1First = createStep({ stepId: "step-1", role: "implement", branchName: "fresh-dispatch-invocation" });

      await executeWorkflow({
        steps: [step1First],
        stateStore: store,
      });

      const run1First = store.findRunByProjectBranch({
        project: "demo",
        branch: "fresh-dispatch-invocation",
        stepId: "step-1",
      });
      const invocationId1First = run1First?.workflowSnapshot?.invocationId;

      // Second invocation with freshDispatch
      const step1Second = createStep({ stepId: "step-1", role: "implement", branchName: "fresh-dispatch-invocation" });

      await executeWorkflow({
        steps: [step1Second],
        stateStore: store,
        freshDispatch: true,
      });

      const run1Second = store.findRunByProjectBranch({
        project: "demo",
        branch: "fresh-dispatch-invocation",
        stepId: "step-1",
      });
      const invocationId1Second = run1Second?.workflowSnapshot?.invocationId;

      expect(invocationId1Second).not.toBe(invocationId1First);
    } finally {
      store.close();
    }
  });

  test("preserves resume behavior when freshDispatch is absent", async () => {
    const stateDbPath = ":memory:";
    const store = openStateStore(stateDbPath);

    try {
      // First invocation: complete step 1, progress on step 2
      const step1First = createStep({ stepId: "step-1", role: "implement", branchName: "resume-preserved" });
      const step2First = createStep({
        stepId: "step-2",
        role: "implement",
        branchName: "resume-preserved",
        createBinding: okTokenBindingFactory("progress"),
        maxIterations: 1,
      });

      const result1 = await executeWorkflow({
        steps: [step1First, step2First],
        stateStore: store,
      });

      expect(result1.kind).toBe("budget-exhausted");
      expect(result1.stepIndex).toBe(1);

      const run1First = store.findRunByProjectBranch({
        project: "demo",
        branch: "resume-preserved",
        stepId: "step-1",
      });
      const invocationId1First = run1First?.workflowSnapshot?.invocationId;

      // Second invocation without freshDispatch: should resume at step 2
      const step1Second = createStep({ stepId: "step-1", role: "implement", branchName: "resume-preserved" });
      const step2Second = createStep({ stepId: "step-2", role: "implement", branchName: "resume-preserved" });

      const result2 = await executeWorkflow({
        steps: [step1Second, step2Second],
        stateStore: store,
        // freshDispatch is NOT set
      });

      expect(result2.kind).toBe("complete");
      expect(result2.stepIndex).toBe(1);

      const run1Second = store.findRunByProjectBranch({
        project: "demo",
        branch: "resume-preserved",
        stepId: "step-1",
      });
      expect(run1Second?.workflowSnapshot?.invocationId).toBe(invocationId1First); // Same invocationId
      expect(run1Second?.attempts).toHaveLength(1); // Only one attempt (from first invocation)
    } finally {
      store.close();
    }
  });
});

describe("executeWorkflow completion publication", () => {
  test("classifies completion publication, ready-gate, and ready-flip failures in results and loop_finished", async () => {
    const cases: Array<{
      kind: "completion_commit_failed" | "ready_gate_failed" | "ready_flip_failed";
      publish: () => Promise<{ pushSha?: string; prNumber?: number }>;
      finalize: () => Promise<void>;
      expectedResumable: boolean;
    }> = [
      {
        kind: "completion_commit_failed",
        publish: async () => {
          throw new Error("publish failed");
        },
        finalize: async () => {},
        expectedResumable: true,
      },
      {
        kind: "completion_commit_failed",
        publish: async () => ({ pushSha: "abc123def456" }),
        finalize: async () => {
          throw new Error("should not finalize when PR evidence is missing");
        },
        expectedResumable: true,
      },
      {
        kind: "ready_gate_failed",
        publish: async () => ({}),
        finalize: async () => {
          throw new ReadyGateError("bun run ready", 1, "red");
        },
        expectedResumable: true,
      },
      {
        kind: "ready_flip_failed",
        publish: async () => ({}),
        finalize: async () => {
          throw new Error("gh pr ready failed");
        },
        expectedResumable: false,
      },
    ];

    for (const testCase of cases) {
      const step = createStep({
        stepId: `publish-${testCase.kind}`,
        role: "implement",
        branchName: `publish-${testCase.kind}`,
      });
      const logSink = new TestLogSink();
      await withStateStore(async (store) => {
        const result = await executeWorkflow({
          steps: [step],
          stateStore: store,
          logSink,
          completionCommitter: async () => ({ commitSha: "commit-1" }),
          completionPublisher: testCase.publish,
          readyFinalizer: testCase.finalize,
        });
        expect(result.kind).toBe(testCase.kind);
        expect(result.resumable).toBe(testCase.expectedResumable);
        expect(logSink.getEventsForRun(result.runId).at(-1)).toMatchObject({
          kind: "loop_finished",
          loopOutcomeKind: testCase.kind,
          resumable: testCase.expectedResumable,
        });
        if (testCase.kind === "ready_gate_failed") {
          expect(logSink.getEventsForRun(result.runId).at(-1)).toMatchObject({
            readyGateCommand: "bun run ready",
            readyGateOutput: "red",
          });
        }
        if (testCase.kind === "completion_commit_failed" || testCase.kind === "ready_gate_failed") {
          expect(store.loadRun(result.runId)?.status).toBe("failed");
        }
      });
    }
  });

  test("settles surviving_mutation_failed as durable failed with resumable terminal details after completion boundary", async () => {
    const step = createStep({
      stepId: "publish-surviving-mutation",
      role: "implement",
      branchName: "publish-surviving-mutation",
    });
    const logSink = new TestLogSink();
    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {
          throw new SurvivingMutationError("operator-flip: === → !==", "src/guard.ts", 17);
        },
      });
      expect(result.kind).toBe("surviving_mutation_failed");
      expect(result.resumable).toBe(true);
      expect(result.survivingMutation).toBe("operator-flip: === → !==");
      expect(result.survivingMutationSourceFile).toBe("src/guard.ts");
      expect(result.survivingMutationSourceLine).toBe(17);
      expect(store.loadRun(result.runId)?.status).toBe("failed");
      expect(logSink.getEventsForRun(result.runId).at(-1)).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "surviving_mutation_failed",
        resumable: true,
        survivingMutation: "operator-flip: === → !==",
        survivingMutationSourceFile: "src/guard.ts",
        survivingMutationSourceLine: 17,
      });
    });
  });

  test("persists a successful not-runnable runtime smoke outcome after workflow completion", async () => {
    const step = createStep({
      stepId: "publish-runtime-smoke-not-runnable",
      role: "implement",
      branchName: "publish-runtime-smoke-not-runnable",
    });
    const logSink = new TestLogSink();
    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => ({
          runtimeSmokeOutcome: {
            kind: "not-runnable",
            inspectedPaths: ["v2/src/execution/write-loop.ts", "shared/subprocess.ts"],
            discoveryReason: nonEmptyDiscoveryReason("no changed runnable entrypoint found"),
          },
        }),
      });
      expect(result.kind).toBe("complete");
      expect(logSink.getEventsForRun(result.runId)).toContainEqual({
        kind: "runtime_smoke_outcome",
        outcome: "not-runnable",
        inspectedPaths: ["v2/src/execution/write-loop.ts", "shared/subprocess.ts"],
        discoveryReason: "no changed runnable entrypoint found",
      });
    });
  });

  test("persists a successful not-runnable runtime smoke outcome when the ready flip fails", async () => {
    const step = createStep({
      stepId: "publish-runtime-smoke-flip-failure",
      role: "implement",
      branchName: "publish-runtime-smoke-flip-failure",
    });
    const logSink = new TestLogSink();
    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {
          throw new ReadyFlipError(new Error("gh pr ready failed"), {
            kind: "not-runnable",
            inspectedPaths: ["v2/src/execution/write-loop.ts"],
            discoveryReason: nonEmptyDiscoveryReason("no changed runnable entrypoint found"),
          });
        },
      });

      expect(result.kind).toBe("ready_flip_failed");
      expect(logSink.getEventsForRun(result.runId)).toContainEqual({
        kind: "runtime_smoke_outcome",
        outcome: "not-runnable",
        inspectedPaths: ["v2/src/execution/write-loop.ts"],
        discoveryReason: "no changed runnable entrypoint found",
      });
    });
  });

  test("surfaces PR number when flip failure occurs after successful publication", async () => {
    const step = createStep({
      stepId: "flip-with-pr",
      role: "implement",
      branchName: "flip-with-pr",
    });
    const logSink = new TestLogSink();
    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({ prNumber: 42 }),
        readyFinalizer: async () => {
          throw new Error("gh pr ready failed");
        },
      });
      expect(result.kind).toBe("ready_flip_failed");
      expect(result.resumable).toBe(false);
      expect(result.readyFlipPrNumber).toBe(42);
      expect(result.readyFlipError).toBeDefined();
    });
  });

  test("omits PR number when flip failure occurs but publication returned no PR", async () => {
    const step = createStep({
      stepId: "flip-no-pr",
      role: "implement",
      branchName: "flip-no-pr",
    });
    const logSink = new TestLogSink();
    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {
          throw new Error("gh pr ready failed");
        },
      });
      expect(result.kind).toBe("ready_flip_failed");
      expect(result.resumable).toBe(false);
      expect(result.readyFlipPrNumber).toBeUndefined();
      expect(result.readyFlipError).toBeDefined();
    });
  });

  test("routes a red ready gate through bounded repair before settlement", async () => {
    const step = createStep({
      stepId: "gate-repair",
      role: "implement",
      branchName: "gate-repair",
    });
    const logSink = new TestLogSink();
    let gateCalls = 0;
    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        runFixCommand: async () => {},
        readyFinalizer: async () => {
          gateCalls += 1;
          if (gateCalls <= 2) throw new ReadyGateError("bun run ready", 1, "tests failed");
        },
      });
      expect(result.kind).toBe("complete");
      expect(gateCalls).toBe(3);
      expect(logSink.getEventsForRun(result.runId)).toContainEqual({
        kind: "ready_gate_repair",
        attempt: 1,
        gateExitCode: 1,
      });
    });
  });

  test("caps ready gate repairs and settles as ready_gate_failed when exhausted", async () => {
    let invocations = 0;
    const trackingBindingFactory = createBindingFactory(async ({ cwd }) => {
      invocations += 1;
      writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
      return { kind: "ok", stdout: "done", stderr: "" } as const;
    });
    const step = createStep({
      stepId: "gate-exhausted",
      role: "implement",
      branchName: "gate-exhausted",
      createBinding: trackingBindingFactory,
    });
    const logSink = new TestLogSink();
    let gateCalls = 0;
    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        runFixCommand: async () => {},
        readyFinalizer: async () => {
          gateCalls += 1;
          throw new ReadyGateError("bun run ready", 2, `failure ${gateCalls}`);
        },
      });
      expect(result.kind).toBe("ready_gate_failed");
      expect(result.resumable).toBe(true);
      expect(invocations).toBe(5);
      expect(gateCalls).toBe(5);
      const events = logSink.getEventsForRun(result.runId);
      expect(events.filter((event) => event.kind === "ready_gate_repair")).toHaveLength(3);
      const run = store.loadRun(result.runId);
      expect(run?.status).toBe("failed");
      expect(run?.retainedFinalizationCheckpoint?.completionAgent).toBeTruthy();
      expect(events.at(-1)).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "ready_gate_failed",
        resumable: true,
        readyGateOrigin: "repair_budget_exhausted",
        readyGateRepairCount: 3,
      });
      expect(run).not.toBeNull();
      if (!run) return;
      const terminalRecord = events.at(-1);
      if (terminalRecord?.kind === "loop_finished") {
        const operatorError = composeRunOperatorError(run, {
          runId: result.runId,
          seq: 1,
          ts: "",
          event: terminalRecord,
        });
        expect(operatorError).toMatchObject({ reason: "ready_gate_failed", nextAction: "resume" });
      }
    });
  });

  test("logs completionCommitError for a real normalized publication push failure", async () => {
    const step = createStep({
      stepId: "publication-push-failure",
      role: "implement",
      branchName: "publication-push-failure",
    });
    const logSink = new TestLogSink();
    const failingGit = async (_cwd: string, args: readonly string[]) => {
      if (args[0] === "push") throw new Error("failed to push some refs to origin");
      return "";
    };
    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: createCompletionPublisher({ git: failingGit }),
      });

      expect(result.kind).toBe("completion_commit_failed");
      expect(result.completionCommitError).toContain("failed to push some refs");

      // Mutation checkpoint: the terminal `loop_finished` record must carry the same
      // `completionCommitError` the workflow result returns, not merely permit it in the schema.
      // @mutate v2/src/execution/workflow-runner.ts "completionCommitError: publicationCommitErrorMessage," -> ""
      const loopFinished = logSink.getEventsForRun(result.runId).filter((event) => event.kind === "loop_finished");
      expect(loopFinished.at(-1)).toMatchObject({
        loopOutcomeKind: "completion_commit_failed",
        completionCommitError: result.completionCommitError,
      });
    });
  });

  function createGateScopeWorkflowStep(
    home: { jarvisRoot: string },
    branchName: string,
    baseRef: string,
    overrides?: Partial<WriteWorkflowStep>,
  ): WriteWorkflowStep {
    roots.push(join(home.jarvisRoot, ".."));
    return {
      behavior: "write",
      worktree: {
        projectRoot: "/fake",
        projectName: "demo",
        branchName,
        baseRef,
        jarvisRoot: home.jarvisRoot,
      },
      specPath: "spec.md",
      stepRules: "Return exactly one terminal token.",
      expectedArtifactPath: "proof.txt",
      agents: ["claude"],
      agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
      createBinding: doneBindingFactory,
      withExternalWorktree: createFakeWithExternalWorktree(home.jarvisRoot),
      stepId: "gate-scope",
      role: "implement",
      readyGateScopeSeams: baseRefProbeFailsSeam,
      ...overrides,
    };
  }

  test("settles an attributed untouched red gate as ready_gate_out_of_scope without repair", async () => {
    const home = createJarvisHome();
    const branchName = "workflow-gate-out-of-scope";
    const { baseRef } = initGateScopeWorktree(home.jarvisRoot, branchName);
    const logSink = new TestLogSink();
    let inScopeGateCalls = 0;
    const outsidePath = "v2/src/untouched.test.ts";
    const outOfScopeDetail = formatReadyGateOutOfScopeDetail([outsidePath], baseRef);

    await withStateStore(async (store) => {
      const outOfScope = await executeWorkflow({
        steps: [createGateScopeWorkflowStep(home, branchName, baseRef)],
        stateStore: store,
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {
          throw new ReadyGateError("bun run ready", 1, gateFailureOutput(outsidePath));
        },
      });
      expect(outOfScope.kind).toBe("ready_gate_out_of_scope");
      expect(outOfScope.resumable).toBe(false);
      expect(outOfScope.readyGateOutsidePaths).toEqual([outsidePath]);
      expect(outOfScope.readyGateOutOfScopeDetail).toBe(outOfScopeDetail);
      expect(outOfScope.readyGateError).toBe(outOfScopeDetail);
      expect(store.loadRun(outOfScope.runId)?.status).toBe("failed");
      expect(logSink.getEventsForRun(outOfScope.runId).filter((event) => event.kind === "ready_gate_repair")).toEqual(
        [],
      );
      expect(logSink.getEventsForRun(outOfScope.runId).at(-1)).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "ready_gate_out_of_scope",
        resumable: false,
        readyGateOutsidePaths: [outsidePath],
        readyGateOutOfScopeDetail: outOfScopeDetail,
      });

      const inScopeBranch = `${branchName}-in-scope`;
      const { baseRef: inScopeBaseRef } = initGateScopeWorktree(home.jarvisRoot, inScopeBranch);
      const inScope = await executeWorkflow({
        steps: [
          createGateScopeWorkflowStep(home, inScopeBranch, inScopeBaseRef, {
            createBinding: createBindingFactory(async ({ cwd }) => {
              writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
              return { kind: "ok", stdout: "done", stderr: "" } as const;
            }),
          }),
        ],
        stateStore: store,
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        runFixCommand: async () => {},
        readyFinalizer: async () => {
          inScopeGateCalls += 1;
          if (inScopeGateCalls <= 2) {
            throw new ReadyGateError("bun run ready", 1, gateFailureOutput("proof.txt"));
          }
        },
      });
      expect(inScope.kind).toBe("complete");
      expect(inScopeGateCalls).toBe(3);
      expect(logSink.getEventsForRun(inScope.runId).filter((event) => event.kind === "ready_gate_repair")).toEqual([
        { kind: "ready_gate_repair", attempt: 1, gateExitCode: 1 },
      ]);
    });
  });

  test("persists ready_gate_out_of_scope evidence through durable logs and operator mirrors", async () => {
    const home = createJarvisHome();
    const branchName = "workflow-gate-out-of-scope-durable";
    const { baseRef } = initGateScopeWorktree(home.jarvisRoot, branchName);
    const outsidePath = "v2/src/untouched.test.ts";
    const outOfScopeDetail = formatReadyGateOutOfScopeDetail([outsidePath], baseRef);
    const logsPath = join(home.jarvisRoot, "logs.jsonl");
    const logSink = openLogSink(logsPath);

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [createGateScopeWorkflowStep(home, branchName, baseRef)],
        stateStore: store,
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {
          throw new ReadyGateError("bun run ready", 1, gateFailureOutput(outsidePath));
        },
      });
      expect(result.kind).toBe("ready_gate_out_of_scope");
      if (result.kind === "ready_gate_out_of_scope") {
        expect(exitCodeForWriteResult(result.kind)).toBe(1);
      }

      const persisted = openLogReader(logsPath).tail(result.runId).at(-1);
      expect(persisted).toBeDefined();
      if (persisted === undefined) throw new Error("expected persisted loop_finished");
      expect(persisted.event).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "ready_gate_out_of_scope",
        resumable: false,
        readyGateOutsidePaths: [outsidePath],
        readyGateOutOfScopeDetail: outOfScopeDetail,
      });

      const terminal = findTerminalLogRecord([persisted]);
      const run = store.loadRun(result.runId);
      const operatorError = composeRunOperatorError(run ?? { status: "failed" }, terminal);
      expect(operatorError).toEqual({
        reason: "ready_gate_out_of_scope",
        retryable: false,
        nextAction: "stop",
        readyGateOutsidePaths: [outsidePath],
        readyGateOutOfScopeDetail: outOfScopeDetail,
      });

      const loopEvent = persisted.event;
      if (loopEvent.kind !== "loop_finished") throw new Error("expected loop_finished");
      const { readyGateOutsidePaths: _paths, readyGateOutOfScopeDetail: _detail, ...eventWithoutPaths } = loopEvent;
      const withoutPaths = composeRunOperatorError(run ?? { status: "failed" }, {
        ...persisted,
        event: eventWithoutPaths,
      });
      expect(withoutPaths?.reason).toBe("ready_gate_out_of_scope");
      expect(withoutPaths?.readyGateOutsidePaths).toBeUndefined();

      const wrongKind = composeRunOperatorError(run ?? { status: "failed" }, {
        ...persisted,
        event: {
          ...eventWithoutPaths,
          loopOutcomeKind: "ready_gate_failed",
        },
      });
      expect(wrongKind?.reason).toBe("ready_gate_failed");
      expect(wrongKind?.readyGateOutsidePaths).toBeUndefined();
    });

    logSink.close();
  });

  test("skips repair when ready-flip failure occurs (non-ReadyGateError)", async () => {
    const step = createStep({
      stepId: "flip-no-repair",
      role: "implement",
      branchName: "flip-no-repair",
    });
    const logSink = new TestLogSink();
    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {
          throw new Error("gh pr ready failed");
        },
      });
      expect(result.kind).toBe("ready_flip_failed");
      expect(result.resumable).toBe(false);
      const events = logSink.getEventsForRun(result.runId);
      expect(events.filter((event) => event.kind === "ready_gate_repair")).toHaveLength(0);
    });
  });

  test("repair iterations count toward workflow iterationsConsumed", async () => {
    const trackingBindingFactory = createBindingFactory(async ({ cwd }) => {
      writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
      return { kind: "ok", stdout: "done", stderr: "" } as const;
    });
    const step = createStep({
      stepId: "repair-counting",
      role: "implement",
      branchName: "repair-counting",
      createBinding: trackingBindingFactory,
    });
    const logSink = new TestLogSink();
    let gateCalls = 0;
    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        runFixCommand: async () => {},
        readyFinalizer: async () => {
          gateCalls += 1;
          if (gateCalls <= 2) throw new ReadyGateError("bun run ready", 1, "red");
        },
      });
      expect(result.kind).toBe("complete");
      expect(result.iterationsConsumed).toBe(3);
    });
  });

  test("retains a supplied title for completion-publication retry", async () => {
    const stateDbPath = ":memory:";
    const firstStep = createStep({
      stepId: "intent",
      role: "implement",
      branchName: "intent-title-retry",
      specPath: "spec/index.md",
    });
    const retryStep = createStep({
      stepId: "intent",
      role: "implement",
      branchName: "intent-title-retry",
      specPath: "spec/index.md",
    });
    const titles: unknown[] = [];
    const store = openStateStore(stateDbPath);
    const jarvisRoot = firstStep.worktree.jarvisRoot;
    if (jarvisRoot === undefined) throw new Error("missing test jarvis root");

    mkdirSync(join(jarvisRoot, "worktrees", "demo", "intent-title-retry", "spec"), { recursive: true });
    writeFileSync(
      join(jarvisRoot, "worktrees", "demo", "intent-title-retry", "spec", "index.md"),
      "# Workflow title\n",
      "utf8",
    );

    try {
      const first = await executeWorkflow({
        steps: [firstStep],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          titles.push(input.creationTitle);
          throw new Error("publish failed");
        },
      });
      expect(first.kind).toBe("completion_commit_failed");

      const retried = await executeWorkflow({
        steps: [retryStep],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          titles.push(input.creationTitle);
          return {};
        },
        readyFinalizer: async () => {},
      });

      expect(retried.kind).toBe("complete");
      expect(titles).toEqual(["Workflow title", "Workflow title"]);
    } finally {
      store.close();
    }
  });

  test("publishes a supplied title after a reviewed workflow completes", async () => {
    const writeStep = createStep({
      stepId: "intent",
      role: "implement",
      branchName: "reviewed-intent-title",
      creationTitle: "intent: reviewed-seed",
    });
    const reviewStep: ReviewWorkflowStep = {
      behavior: "review",
      stepId: "review",
      project: "demo",
      branch: "reviewed-intent-title",
      cwd: "/fake",
      prompt: "review",
      verdictPath: join(mkdtempSync(join(tmpdir(), "workflow-review-title-")), "verdict.md"),
      maxCycles: 1,
      agents: { critic: ["claude"], actuator: ["codex"] },
      agentModelConfig: {
        claude: { critic: { rungs: [{ adapterModel: "critic", priceKey: "critic" }] } },
        codex: { actuator: { rungs: [{ adapterModel: "actuator", priceKey: "actuator" }] } },
      },
      createBinding: ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
        metadata: { agent: agentId, model: adapterModel },
        invoke: async () => ({ kind: "ok" as const, stdout: agentId === "claude" ? "apply" : "done", stderr: "" }),
      }),
    };
    const titles: unknown[] = [];

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [writeStep, reviewStep],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          titles.push(input.creationTitle);
          return {};
        },
        readyFinalizer: async () => {},
      });

      expect(result.kind).toBe("complete");
      expect(titles).toEqual(["intent: reviewed-seed"]);
    });
  });

  test("publishes intent-run body summary from the landed durable dir", async () => {
    const invocationId = "intent-body-summary-inv";
    const summaries: Array<string | undefined> = [];
    const { workspace, withExternalWorktree } = createIntentWorktreeHarness("intent-body-summary");
    const baseStep = createStep({
      stepId: "intent",
      role: "plan",
      branchName: "intent-body-summary",
      specPath: "ready-intents",
      landing: {
        kind: "intent-stage",
        output: { durableDir: "ready-intents" },
        stagingDir: ".jarvis-intent-stage",
        invocationId,
        baseRef: "none",
      },
      creationTitle: "intent: seed-subject",
      workflowInvocationId: invocationId,
      withExternalWorktree,
      agentModelConfig: {
        claude: {
          plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
        },
      },
    });
    const step: WriteWorkflowStep = {
      ...baseStep,
      worktree: { ...baseStep.worktree, git: false, localPath: workspace },
    };

    await withStateStore(async (store) => {
      seedLandedIntentFiles(workspace, invocationId, ["alpha.md", "beta.md"]);
      seedCompletedWriteRun(store, step, workspace, invocationId);

      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          summaries.push(input.bodySummary);
          return {};
        },
        readyFinalizer: async () => {},
      });

      expect(result.kind).toBe("complete");
      expect(summaries).toEqual(["intent: seed-subject\n- alpha.md\n- beta.md"]);
    });
  });

  test("re-derives the same intent-run body summary on completion-publication retry", async () => {
    const invocationId = "intent-body-summary-retry";
    const summaries: Array<string | undefined> = [];
    const { workspace, withExternalWorktree } = createIntentWorktreeHarness("intent-body-summary-retry");
    const baseStep = createStep({
      stepId: "intent",
      role: "plan",
      branchName: "intent-body-summary-retry",
      specPath: "ready-intents",
      landing: {
        kind: "intent-stage",
        output: { durableDir: "ready-intents" },
        stagingDir: ".jarvis-intent-stage",
        invocationId,
        baseRef: "none",
      },
      creationTitle: "intent: seed-subject",
      workflowInvocationId: invocationId,
      withExternalWorktree,
      agentModelConfig: {
        claude: {
          plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
        },
      },
    });
    const step: WriteWorkflowStep = {
      ...baseStep,
      worktree: { ...baseStep.worktree, git: false, localPath: workspace },
    };

    await withStateStore(async (store) => {
      seedLandedIntentFiles(workspace, invocationId, ["one.md"]);
      seedCompletedWriteRun(store, step, workspace, invocationId);

      const failed = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          summaries.push(input.bodySummary);
          throw new Error("publish failed");
        },
      });
      expect(failed.kind).toBe("completion_commit_failed");

      const retried = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          summaries.push(input.bodySummary);
          return {};
        },
        readyFinalizer: async () => {},
      });
      expect(retried.kind).toBe("complete");
      expect(summaries).toEqual(["intent: seed-subject\n- one.md", "intent: seed-subject\n- one.md"]);
    });
  });

  test("markdown-only ready-gate skip retains staged non-Markdown rejection", async () => {
    const invocationId = "intent-non-markdown-stage";
    const { workspace, withExternalWorktree } = createIntentWorktreeHarness(invocationId);
    const baseStep = createStep({
      stepId: "intent",
      role: "plan",
      promptId: "intent.prompt.split",
      branchName: invocationId,
      specPath: "ready-intents",
      expectedArtifactPath: ".jarvis-intent-stage",
      landing: {
        kind: "intent-stage",
        output: { durableDir: "ready-intents" },
        stagingDir: ".jarvis-intent-stage",
        invocationId,
        baseRef: "HEAD",
      },
      workflowInvocationId: invocationId,
      withExternalWorktree,
      agentModelConfig: { claude: { plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] } } },
    });
    const step: WriteWorkflowStep = {
      ...baseStep,
      worktree: { ...baseStep.worktree, git: false, localPath: workspace },
    };
    const stagingDir = join(workspace, ".jarvis-intent-stage");
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(stagingDir, "valid.md"), "---\nname: valid\n---\n\n# Valid\n\n## Prerequisites\n", "utf8");
    writeFileSync(join(stagingDir, "source.ts"), "export {};\n", "utf8");

    const logSink = new TestLogSink();
    let completionCommitterCalled = false;
    let completionPublisherCalled = false;
    let readyFinalizerCalled = false;
    await withStateStore(async (store) => {
      seedCompletedWriteRun(store, step, workspace, invocationId);
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        logSink,
        completionCommitter: async () => {
          completionCommitterCalled = true;
          return {};
        },
        completionPublisher: async () => {
          completionPublisherCalled = true;
          return {};
        },
        readyFinalizer: async () => {
          readyFinalizerCalled = true;
        },
      });

      expect(result.kind).toBe("pre-publication");
      expect(result.prePublicationError).toContain("expected only markdown files");
      expect(store.loadRun(result.runId)?.status).toBe("failed");
      expect(
        logSink
          .getEventsForRun(result.runId)
          .filter((event) => event.kind === "loop_finished")
          .at(-1),
      ).toMatchObject({ kind: "loop_finished", loopOutcomeKind: "landing_failed" });
    });
    expect({ completionCommitterCalled, completionPublisherCalled, readyFinalizerCalled }).toEqual({
      completionCommitterCalled: false,
      completionPublisherCalled: false,
      readyFinalizerCalled: false,
    });
  });

  test("workflow completion and resume retain the fail-soft uncommitted-path contract", async () => {
    const nestedPath = "nested-dir/only-dirt.txt";
    const invocationId = "workflow-uncommitted-inventory-inv";
    const branchName = "workflow-uncommitted-inventory";
    const noOpPublicationTail = {
      completionCommitter: async () => ({}),
      completionPublisher: async () => ({}),
      readyFinalizer: async () => {},
    };
    const step = createStep({
      stepId: "implement",
      role: "implement",
      branchName,
      workflowInvocationId: invocationId,
      createBinding: doneBindingFactory,
    });
    const jarvisRoot = step.worktree.jarvisRoot;
    if (jarvisRoot === undefined) throw new Error("missing jarvis root");
    const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
    mkdirSync(worktreePath, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: worktreePath, stdio: "pipe" });
    execFileSync("git", ["-C", worktreePath, "config", "user.email", "test@example.com"], { stdio: "pipe" });
    execFileSync("git", ["-C", worktreePath, "config", "user.name", "Test User"], { stdio: "pipe" });
    writeFileSync(join(worktreePath, "spec.md"), "- [ ] work\n", "utf8");
    execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
    execFileSync("git", ["-C", worktreePath, "commit", "-qm", "seed"], { stdio: "pipe" });
    const logSink = new TestLogSink();

    await withStateStore(async (store) => {
      seedCompletedWriteRun(store, step, worktreePath, invocationId);
      mkdirSync(join(worktreePath, "nested-dir"), { recursive: true });
      writeFileSync(join(worktreePath, nestedPath), "only dirt\n", "utf8");

      for (const _attempt of [0, 1]) {
        const result = await executeWorkflow({
          steps: [step],
          stateStore: store,
          logSink,
          ...noOpPublicationTail,
        });
        expect(result.kind).toBe("completion_commit_failed");
        expect(result.completionCommitError).toContain(nestedPath);
      }
    });

    const plainWorkspace = mkdtempSync(join(tmpdir(), "workflow-uncommitted-fail-soft-"));
    roots.push(plainWorkspace);
    const plainBase = createStep({
      stepId: "implement",
      role: "implement",
      branchName: "workflow-uncommitted-fail-soft",
      createBinding: createBindingFactory(async ({ cwd }) => {
        writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
        return { kind: "ok", stdout: "done", stderr: "" };
      }),
    });
    const plainStep: WriteWorkflowStep = {
      ...plainBase,
      worktree: { ...plainBase.worktree, git: false, localPath: plainWorkspace },
      withExternalWorktree: externalWorktreeBinding(plainWorkspace),
    };

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [plainStep], stateStore: store, ...noOpPublicationTail });
      expect(result.kind).toBe("complete");
    });
  });

  test("does not record done completion boundary when intent stage remains uncommitted", async () => {
    // Plain (non-git) workspace: `git status --porcelain` fails here, so `getUncommittedPaths`
    // alone can't see a leftover staged file — only `remainingStagedIntentPaths` does.
    const workspace = mkdtempSync(join(tmpdir(), "intent-leftover-stage-"));
    const withExternalWorktree = externalWorktreeBinding(workspace);
    const stagingDir = join(workspace, ".jarvis-intent-stage");
    const durableDir = join(workspace, "ready-intents");
    const baseStep = createStep({
      stepId: "intent",
      role: "plan",
      branchName: "intent-leftover-stage",
      specPath: "ready-intents",
      expectedArtifactPath: ".jarvis-intent-stage",
      landing: {
        kind: "intent-stage",
        output: { durableDir: "ready-intents" },
        stagingDir: ".jarvis-intent-stage",
        invocationId: "intent-leftover-stage",
        baseRef: "none",
      },
      agentModelConfig: { claude: { plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] } } },
      creationTitle: "intent: leftover-stage",
      withExternalWorktree,
      createBinding: createBindingFactory(async ({ cwd }) => {
        mkdirSync(join(cwd, ".jarvis-intent-stage"), { recursive: true });
        writeFileSync(
          join(cwd, ".jarvis-intent-stage", "alpha.md"),
          "---\nname: alpha\n---\n\n# Alpha\n\n## Prerequisites\n",
          "utf8",
        );
        return { kind: "ok" as const, stdout: "done", stderr: "" };
      }),
    });
    const step: WriteWorkflowStep = {
      ...baseStep,
      worktree: { ...baseStep.worktree, git: false, localPath: workspace },
    };

    const logSink = new TestLogSink();
    await withStateStore(async (store) => {
      // The committer reports no new commit but leaves a stray staged file behind — the same
      // shape as a commit that silently no-ops while `.jarvis-intent-stage/` is still populated.
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        logSink,
        completionCommitter: async () => {
          mkdirSync(stagingDir, { recursive: true });
          writeFileSync(join(stagingDir, "leftover.md"), "leftover\n", "utf8");
          return {};
        },
      });

      expect(result.kind).toBe("completion_commit_failed");
      expect(result.completionCommitError).toContain("leftover.md");
      expect(store.loadRun(result.runId)?.status).toBe("failed");
      expect(store.loadRun(result.runId)?.status).not.toBe("completed");

      // Mutation checkpoint: the terminal `loop_finished` record must carry the same
      // `completionCommitError` the workflow result returns, not merely permit it in the schema.
      // @mutate v2/src/execution/workflow-runner.ts "completionCommitError: uncommittedChangesMessage," -> ""
      const loopFinished = logSink.getEventsForRun(result.runId).filter((event) => event.kind === "loop_finished");
      expect(loopFinished.at(-1)).toMatchObject({
        loopOutcomeKind: "completion_commit_failed",
        completionCommitError: result.completionCommitError,
      });
    });

    expect(readFileSync(join(durableDir, "alpha.md"), "utf8")).toContain("# Alpha");
  });

  test("does not emit an empty failed row when log shows loop_finished complete", async () => {
    // Non-reviewed intent workflow: the write step's own loop settles `loop_finished complete`
    // on its row (write-loop.ts) before the workflow-completion tail attempts promotion. When
    // promotion (`landPublication`) then fails on a durable-dir collision, the row's log and its
    // durable status must agree — `composeRunOperatorError` must not fall through to an empty or
    // generically-classified row for the split.
    const workspace = mkdtempSync(join(tmpdir(), "intent-tail-log-disagreement-"));
    const withExternalWorktree = externalWorktreeBinding(workspace);
    const durableDir = join(workspace, "ready-intents");
    mkdirSync(durableDir, { recursive: true });
    writeFileSync(join(durableDir, "example.md"), "different\n", "utf8");
    const baseStep = createStep({
      stepId: "intent",
      role: "plan",
      branchName: "intent-tail-log-disagreement",
      specPath: "ready-intents",
      expectedArtifactPath: ".jarvis-intent-stage",
      landing: {
        kind: "intent-stage",
        output: { durableDir: "ready-intents" },
        stagingDir: ".jarvis-intent-stage",
        invocationId: "intent-tail-log-disagreement",
        baseRef: "none",
      },
      agentModelConfig: { claude: { plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] } } },
      creationTitle: "intent: tail-log-disagreement",
      withExternalWorktree,
      createBinding: createBindingFactory(async ({ cwd }) => {
        mkdirSync(join(cwd, ".jarvis-intent-stage"), { recursive: true });
        writeFileSync(join(cwd, ".jarvis-intent-stage", "example.md"), "staged\n", "utf8");
        return { kind: "ok" as const, stdout: "done", stderr: "" };
      }),
    });
    const step: WriteWorkflowStep = {
      ...baseStep,
      worktree: { ...baseStep.worktree, git: false, localPath: workspace },
    };

    const logSink = new TestLogSink();
    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store, logSink });

      expect(result.kind).toBe("pre-publication");
      const run = store.loadRun(result.runId);
      expect(run?.status).toBe("failed");

      const events = logSink.getEventsForRun(result.runId);
      const loopFinished = events.filter((event) => event.kind === "loop_finished");
      // The write step's own `complete` boundary is present, but it must not be the last word:
      // a distinct finalization-failure record must follow it so log and split agree.
      expect(loopFinished.at(-1)).toMatchObject({ loopOutcomeKind: "landing_failed", resumable: true });

      const lastEvent = loopFinished.at(-1);
      if (lastEvent === undefined) throw new Error("expected a loop_finished event");
      const terminal = findTerminalLogRecord([{ event: lastEvent } as never]);
      const operatorError = composeRunOperatorError(run ?? { status: "failed" }, terminal);
      expect(operatorError).toMatchObject({ reason: "landing_failed", retryable: true, nextAction: "resume" });
    });
  });

  test("publishes reviewed-intent body summary after review-last landing", async () => {
    const { workspace, withExternalWorktree } = createIntentWorktreeHarness("reviewed-intent-body-summary");
    const invocationId = "reviewed-intent-body-summary";
    const summaries: Array<string | undefined> = [];
    const baseWriteStep = createStep({
      stepId: "intent",
      role: "plan",
      branchName: "reviewed-intent-body-summary",
      specPath: "ready-intents",
      landing: {
        kind: "intent-stage",
        output: { durableDir: "ready-intents" },
        stagingDir: ".jarvis-intent-stage",
        invocationId,
        baseRef: "none",
      },
      creationTitle: "intent: reviewed-seed",
      workflowInvocationId: invocationId,
      withExternalWorktree,
      agentModelConfig: {
        claude: {
          plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
        },
      },
    });
    const writeStep: WriteWorkflowStep = {
      ...baseWriteStep,
      worktree: { ...baseWriteStep.worktree, git: false, localPath: workspace },
    };
    const reviewStep: ReviewWorkflowStep = {
      behavior: "review",
      stepId: "review",
      project: "demo",
      branch: "reviewed-intent-body-summary",
      cwd: workspace,
      prompt: "review",
      verdictPath: join(workspace, ".jarvis-intent-review-verdict.md"),
      maxCycles: 1,
      agents: { critic: ["claude"], actuator: ["codex"] },
      agentModelConfig: {
        claude: { critic: { rungs: [{ adapterModel: "critic", priceKey: "critic" }] } },
        codex: { actuator: { rungs: [{ adapterModel: "actuator", priceKey: "actuator" }] } },
      },
      landing: {
        kind: "intent-stage",
        output: { durableDir: "ready-intents" },
        stagingDir: join(workspace, ".jarvis-intent-stage"),
        invocationId,
        baseRef: "HEAD",
      },
      createBinding: ({ agentId }) => ({
        id: agentId,
        metadata: { agent: agentId, model: agentId },
        invoke: async () => ({ kind: "ok" as const, stdout: agentId === "claude" ? "apply" : "done", stderr: "" }),
      }),
    };

    await withStateStore(async (store) => {
      seedLandedIntentFiles(workspace, invocationId, ["reviewed.md"]);
      seedCompletedWriteRun(store, writeStep, workspace, invocationId);
      const reviewRunId = store.createRun({
        project: "demo",
        specRef: "",
        worktreePath: workspace,
        branch: "reviewed-intent-body-summary",
        specPath: "",
        stepId: "review",
      });
      const reviewAttemptId = store.recordAttemptStart(reviewRunId);
      store.commitCompletionBoundary({
        attemptId: reviewAttemptId,
        runStatus: "completed",
        outcomeKind: "done",
        completionAgent: "codex",
      });

      const result = await executeWorkflow({
        steps: [writeStep, reviewStep],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          summaries.push(input.bodySummary);
          return {};
        },
        readyFinalizer: async () => {},
      });

      expect(result.kind).toBe("complete");
      expect(summaries).toEqual(["intent: reviewed-seed\n- reviewed.md"]);
    });
  });

  test("plan workflow publishes draft PR with index.md H1 as title", async () => {
    const step = createStep({
      stepId: "plan",
      role: "plan",
      branchName: "plan-title-test",
      specPath: "spec/2026-01-01T00-00-00Z-test-plan/index.md",
      agentModelConfig: {
        claude: {
          plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
        },
      },
    });
    const titles: unknown[] = [];
    const jarvisRoot = step.worktree.jarvisRoot;
    if (jarvisRoot === undefined) throw new Error("missing test jarvis root");

    mkdirSync(join(jarvisRoot, "worktrees", "demo", "plan-title-test", "spec", "2026-01-01T00-00-00Z-test-plan"), {
      recursive: true,
    });
    writeFileSync(
      join(jarvisRoot, "worktrees", "demo", "plan-title-test", "spec", "2026-01-01T00-00-00Z-test-plan", "index.md"),
      "# My feature plan\n\nContent here.",
      "utf8",
    );

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          titles.push(input.creationTitle);
          return {};
        },
        readyFinalizer: async () => {},
      });

      expect(result.kind).toBe("complete");
      expect(titles).toEqual(["My feature plan"]);
    });
  });

  test("plan workflow with a bare spec-directory specPath publishes index.md H1 as title", async () => {
    // plan-workflow-steps.ts sets specPath to the spec directory itself, not a path ending in index.md.
    const step = createStep({
      stepId: "plan",
      role: "plan",
      branchName: "plan-title-dir-test",
      specPath: "spec/2026-01-01T00-00-00Z-test-plan-dir",
      agentModelConfig: {
        claude: {
          plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
        },
      },
    });
    const titles: unknown[] = [];
    const jarvisRoot = step.worktree.jarvisRoot;
    if (jarvisRoot === undefined) throw new Error("missing test jarvis root");

    mkdirSync(
      join(jarvisRoot, "worktrees", "demo", "plan-title-dir-test", "spec", "2026-01-01T00-00-00Z-test-plan-dir"),
      {
        recursive: true,
      },
    );
    writeFileSync(
      join(
        jarvisRoot,
        "worktrees",
        "demo",
        "plan-title-dir-test",
        "spec",
        "2026-01-01T00-00-00Z-test-plan-dir",
        "index.md",
      ),
      "# My directory-sourced plan\n\nContent here.",
      "utf8",
    );

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          titles.push(input.creationTitle);
          return {};
        },
        readyFinalizer: async () => {},
      });

      expect(result.kind).toBe("complete");
      expect(titles).toEqual(["My directory-sourced plan"]);
    });
  });

  test("plan workflow retry retains original index.md H1 title when index cannot be re-read", async () => {
    const stateDbPath = ":memory:";
    const firstStep = createStep({
      stepId: "plan",
      role: "plan",
      branchName: "plan-title-retry",
      specPath: "spec/2026-01-01T00-00-00Z-test-retry/index.md",
      agentModelConfig: {
        claude: {
          plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
        },
      },
    });
    const retryStep = createStep({
      stepId: "plan",
      role: "plan",
      branchName: "plan-title-retry",
      specPath: "spec/2026-01-01T00-00-00Z-test-retry/index.md",
      agentModelConfig: {
        claude: {
          plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
        },
      },
    });
    const titles: unknown[] = [];
    const store = openStateStore(stateDbPath);
    const jarvisRoot = firstStep.worktree.jarvisRoot;
    if (jarvisRoot === undefined) throw new Error("missing test jarvis root");

    mkdirSync(join(jarvisRoot, "worktrees", "demo", "plan-title-retry", "spec", "2026-01-01T00-00-00Z-test-retry"), {
      recursive: true,
    });
    writeFileSync(
      join(jarvisRoot, "worktrees", "demo", "plan-title-retry", "spec", "2026-01-01T00-00-00Z-test-retry", "index.md"),
      "# Plan for retry test\n\nContent.",
      "utf8",
    );

    try {
      const first = await executeWorkflow({
        steps: [firstStep],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          titles.push(input.creationTitle);
          throw new Error("publish failed");
        },
      });
      expect(first.kind).toBe("completion_commit_failed");

      // Delete the index.md so it cannot be re-read on retry
      const indexPath = join(
        jarvisRoot,
        "worktrees",
        "demo",
        "plan-title-retry",
        "spec",
        "2026-01-01T00-00-00Z-test-retry",
        "index.md",
      );
      const fs = await import("node:fs");
      fs.unlinkSync(indexPath);

      const retried = await executeWorkflow({
        steps: [retryStep],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          titles.push(input.creationTitle);
          return {};
        },
        readyFinalizer: async () => {},
      });

      expect(retried.kind).toBe("complete");
      expect(titles).toEqual(["Plan for retry test", "Plan for retry test"]);
    } finally {
      store.close();
    }
  });

  test("publishes spec-run body summary from index.md H1 and checklist", async () => {
    const summaries: Array<string | undefined> = [];
    const step = createStep({
      stepId: "plan",
      role: "plan",
      promptId: "plan.prompt.draft",
      branchName: "plan-body-summary",
      specPath: "spec/2026-01-01T00-00-00Z-plan-body",
      agentModelConfig: {
        claude: {
          plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
        },
      },
    });
    const jarvisRoot = step.worktree.jarvisRoot;
    if (jarvisRoot === undefined) throw new Error("missing test jarvis root");
    const worktreePath = join(jarvisRoot, "worktrees", "demo", "plan-body-summary");

    const specDir = join(worktreePath, "spec", "2026-01-01T00-00-00Z-plan-body");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(
      join(specDir, "index.md"),
      "# Plan body summary\n\n- [ ] [00 - First](./00-first.md)\n- [x] [01 - Second](./01-second.md)\n",
      "utf8",
    );

    await withStateStore(async (store) => {
      seedCompletedWriteRun(store, step, worktreePath, "plan-body-summary-inv");
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          summaries.push(input.bodySummary);
          return {};
        },
        readyFinalizer: async () => {},
      });

      expect(result.kind).toBe("complete");
      expect(summaries).toEqual(["## Subspecs\n- 00 - First\n- 01 - Second"]);
    });
  });

  test("re-derives the same spec-run body summary on completion-publication retry", async () => {
    const summaries: Array<string | undefined> = [];
    const step = createStep({
      stepId: "plan",
      role: "plan",
      promptId: "plan.prompt.draft",
      branchName: "plan-body-summary-retry",
      specPath: "spec/2026-01-01T00-00-00Z-plan-retry",
      agentModelConfig: {
        claude: {
          plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
        },
      },
    });
    const jarvisRoot = step.worktree.jarvisRoot;
    if (jarvisRoot === undefined) throw new Error("missing test jarvis root");
    const worktreePath = join(jarvisRoot, "worktrees", "demo", "plan-body-summary-retry");
    const specDir = join(worktreePath, "spec", "2026-01-01T00-00-00Z-plan-retry");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, "index.md"), "# Retry plan\n\n- [ ] [00 - Only](./00-only.md)\n", "utf8");

    await withStateStore(async (store) => {
      seedCompletedWriteRun(store, step, worktreePath, "plan-body-summary-retry-inv");

      const failed = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          summaries.push(input.bodySummary);
          throw new Error("publish failed");
        },
      });
      expect(failed.kind).toBe("completion_commit_failed");

      const retried = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          summaries.push(input.bodySummary);
          return {};
        },
        readyFinalizer: async () => {},
      });
      expect(retried.kind).toBe("complete");
      expect(summaries).toEqual(["## Subspecs\n- 00 - Only", "## Subspecs\n- 00 - Only"]);
    });
  });

  test("refreshes spec-run body summary when index checklist changes", async () => {
    const summaries: Array<string | undefined> = [];
    const step = createStep({
      stepId: "plan",
      role: "plan",
      promptId: "plan.prompt.draft",
      branchName: "plan-body-summary-refresh",
      specPath: "spec/2026-01-01T00-00-00Z-plan-refresh",
      agentModelConfig: {
        claude: {
          plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
        },
      },
    });
    const jarvisRoot = step.worktree.jarvisRoot;
    if (jarvisRoot === undefined) throw new Error("missing test jarvis root");
    const worktreePath = join(jarvisRoot, "worktrees", "demo", "plan-body-summary-refresh");
    const indexPath = join(worktreePath, "spec", "2026-01-01T00-00-00Z-plan-refresh", "index.md");
    mkdirSync(join(worktreePath, "spec", "2026-01-01T00-00-00Z-plan-refresh"), { recursive: true });
    writeFileSync(indexPath, "# Refresh plan\n\n- [ ] [00 - Alpha](./00-alpha.md)\n", "utf8");

    await withStateStore(async (store) => {
      seedCompletedWriteRun(store, step, worktreePath, "plan-body-summary-refresh-inv");

      await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          summaries.push(input.bodySummary);
          throw new Error("publish failed");
        },
      });

      writeFileSync(
        indexPath,
        "# Refresh plan\n\n- [ ] [00 - Alpha](./00-alpha.md)\n- [ ] [01 - Beta](./01-beta.md)\n",
        "utf8",
      );

      const retried = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          summaries.push(input.bodySummary);
          return {};
        },
        readyFinalizer: async () => {},
      });
      expect(retried.kind).toBe("complete");
      expect(summaries).toEqual(["## Subspecs\n- 00 - Alpha", "## Subspecs\n- 00 - Alpha\n- 01 - Beta"]);
    });
  });

  test("publishes H1-only spec-run summary when index has no checklist items", async () => {
    const summaries: Array<string | undefined> = [];
    const step = createStep({
      stepId: "plan",
      role: "plan",
      promptId: "plan.prompt.draft",
      branchName: "plan-body-summary-h1-only",
      specPath: "spec/2026-01-01T00-00-00Z-plan-h1",
      agentModelConfig: {
        claude: {
          plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
        },
      },
    });
    const jarvisRoot = step.worktree.jarvisRoot;
    if (jarvisRoot === undefined) throw new Error("missing test jarvis root");
    const worktreePath = join(jarvisRoot, "worktrees", "demo", "plan-body-summary-h1-only");
    const specDir = join(worktreePath, "spec", "2026-01-01T00-00-00Z-plan-h1");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, "index.md"), "# H1 only plan\n\nDraft prose.\n", "utf8");

    await withStateStore(async (store) => {
      seedCompletedWriteRun(store, step, worktreePath, "plan-body-summary-h1-only-inv");
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          summaries.push(input.bodySummary);
          return {};
        },
        readyFinalizer: async () => {},
      });
      expect(result.kind).toBe("complete");
      expect(summaries).toEqual(["(no content)"]);
    });
  });

  test("publishes no spec-run summary when index.md is missing", async () => {
    const summaries: Array<string | undefined> = [];
    const step = createStep({
      stepId: "plan",
      role: "plan",
      promptId: "plan.prompt.draft",
      branchName: "plan-body-summary-missing",
      specPath: "spec/2026-01-01T00-00-00Z-plan-missing",
      agentModelConfig: {
        claude: {
          plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
        },
      },
    });
    const jarvisRoot = step.worktree.jarvisRoot;
    if (jarvisRoot === undefined) throw new Error("missing test jarvis root");
    const worktreePath = join(jarvisRoot, "worktrees", "demo", "plan-body-summary-missing");

    await withStateStore(async (store) => {
      seedCompletedWriteRun(store, step, worktreePath, "plan-body-summary-missing-inv");
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          summaries.push(input.bodySummary);
          return {};
        },
        readyFinalizer: async () => {},
      });
      expect(result.kind).toBe("complete");
      expect(summaries).toEqual(["(no content)"]);
    });
  });

  test("implement workflow completion publishes spec-run body summary", async () => {
    const summaries: Array<string | undefined> = [];
    const specTemplates: boolean[] = [];
    const { step, workspace } = createImplementBodySummaryStep("implement-body-summary");

    await withStateStore(async (store) => {
      seedCompletedWriteRun(store, step, workspace, "implement-body-summary-inv");
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          summaries.push(input.bodySummary);
          specTemplates.push(input.specTemplate === true);
          return {};
        },
        readyFinalizer: async () => {},
      });
      expect(result.kind).toBe("complete");
      expect(specTemplates).toEqual([true]);
      const summary = summaries[0];
      expect(summary).toContain("## Subspecs");
      expect(summary).toContain("- 00 - First — Implement the feature.");
      expect(summary).toContain("## Commits");
      expect(summary).toContain("- add feature");
      expect(summary).toContain("## Risk cues\n- no test changes");
      expect(summary).toContain("## Change summary");
      expect(summary).toContain("v2/src");
    });
  });

  test("re-derives the same implement spec-run body summary on completion-publication retry", async () => {
    const summaries: Array<string | undefined> = [];
    const specTemplates: boolean[] = [];
    const { step, workspace } = createImplementBodySummaryStep("implement-body-summary-retry");

    await withStateStore(async (store) => {
      seedCompletedWriteRun(store, step, workspace, "implement-body-summary-retry-inv");

      const failed = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          summaries.push(input.bodySummary);
          specTemplates.push(input.specTemplate === true);
          throw new Error("publish failed");
        },
      });
      expect(failed.kind).toBe("completion_commit_failed");

      const retried = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          summaries.push(input.bodySummary);
          specTemplates.push(input.specTemplate === true);
          return {};
        },
        readyFinalizer: async () => {},
      });
      expect(retried.kind).toBe("complete");
      expect(specTemplates).toEqual([true, true]);
      expect(summaries[0]).toBe(summaries[1]);
    });
  });

  /** Commit `fileName` in `workspace` as the base commit, returning its sha. */
  function commitBaseRef(workspace: string, fileName: string, content: string): string {
    writeFileSync(join(workspace, fileName), content, "utf8");
    execFileSync("git", ["add", "."], { cwd: workspace });
    execFileSync("git", ["commit", "-qm", "base"], { cwd: workspace });
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8" }).trim();
  }

  /**
   * A write step whose implement and shrink prompts both settle without touching any file —
   * `expectedArtifactPath` ("proof.txt") is created up front so `artifact.exists` is already
   * satisfied. `aheadOfBase` seeds one real committed file change ahead of `baseRef` before the
   * no-work boundary; without it, the branch has zero content ahead of base at all.
   */
  function noWorkShrinkStep(branchName: string, aheadOfBase: boolean): { workspace: string; step: WriteWorkflowStep } {
    const workspace = initGitWorkspace(`no-work-shrink-${branchName}-`);
    const baseRef = commitBaseRef(workspace, "proof.txt", "ok\n");

    if (aheadOfBase) {
      writeFileSync(join(workspace, "feature.txt"), "feature\n", "utf8");
      execFileSync("git", ["add", "."], { cwd: workspace });
      execFileSync("git", ["commit", "-qm", "add feature"], { cwd: workspace });
    }

    const step = createStep({
      stepId: "implement",
      role: "implement",
      branchName,
      createBinding: ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
        invoke: ({ prompt }) =>
          Promise.resolve({
            kind: "ok",
            stdout: prompt.includes("Post-completion Shrink") ? "done" : "no-work",
            stderr: "",
          } as const),
        metadata: { agent: agentId, model: adapterModel },
      }),
    });
    step.worktree = {
      projectRoot: workspace,
      projectName: "demo",
      branchName,
      baseRef,
      git: false,
      localPath: workspace,
    };
    step.withExternalWorktree = externalWorktreeBinding(workspace);
    return { workspace, step };
  }

  test("a completed run with no content ahead of base neither pushes nor opens a PR", async () => {
    // @mutate v2/src/execution/workflow-runner.ts "if (published.commitSha !== undefined && baseDiffOutcome !== \"empty\") {" -> "if (published.commitSha !== undefined) {"
    const { workspace, step } = noWorkShrinkStep("no-content-ahead-of-base", false);
    const headBeforeCompletionCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: workspace,
      encoding: "utf8",
    }).trim();
    let publisherCalled = false;

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionPublisher: async () => {
          publisherCalled = true;
          return {};
        },
      });
      expect(result.kind).toBe("complete");
    });

    expect(publisherCalled).toBe(false);
    expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8" }).trim()).toBe(
      headBeforeCompletionCommit,
    );
  });

  test("a no-work shrink over a branch already ahead of base still pushes and opens the draft PR", async () => {
    const { step } = noWorkShrinkStep("shrink-over-existing-content", true);
    const publisherCalls: Array<{ branch: string; baseRef: string }> = [];

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionPublisher: async (input) => {
          publisherCalls.push({ branch: input.branch, baseRef: input.baseRef });
          return {};
        },
        readyFinalizer: async () => {},
      });
      expect(result.kind).toBe("complete");
    });

    expect(publisherCalls).toEqual([{ branch: step.worktree.branchName, baseRef: step.worktree.baseRef }]);
  });

  /**
   * A branch one commit ahead of `baseRef` (`feature.txt` added) whose `implement` pass deletes
   * `feature.txt` again during the run — a boundary that legitimately reverts branch content back
   * to base. The completion commit this produces has real changes vs its own parent (the "add
   * feature" commit) even though its diff against base is empty.
   */
  function revertToBaseStep(branchName: string): { workspace: string; step: WriteWorkflowStep } {
    const workspace = initGitWorkspace(`revert-to-base-${branchName}-`);
    const baseRef = commitBaseRef(workspace, "proof.txt", "ok\n");
    writeFileSync(join(workspace, "feature.txt"), "feature\n", "utf8");
    execFileSync("git", ["add", "."], { cwd: workspace });
    execFileSync("git", ["commit", "-qm", "add feature"], { cwd: workspace });

    const step = createStep({
      stepId: "implement",
      role: "implement",
      branchName,
      createBinding: ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
        invoke: ({ prompt }) => {
          if (!prompt.includes("Post-completion Shrink")) {
            rmSync(join(workspace, "feature.txt"));
          }
          return Promise.resolve({
            kind: "ok",
            stdout: prompt.includes("Post-completion Shrink") ? "done" : "no-work",
            stderr: "",
          } as const);
        },
        metadata: { agent: agentId, model: adapterModel },
      }),
    });
    step.worktree = {
      projectRoot: workspace,
      projectName: "demo",
      branchName,
      baseRef,
      git: false,
      localPath: workspace,
    };
    step.withExternalWorktree = externalWorktreeBinding(workspace);
    return { workspace, step };
  }

  test("a boundary that reverts branch content back to base keeps the commit but does not publish", async () => {
    const { workspace, step } = revertToBaseStep("revert-to-base");
    let publisherCalled = false;

    let headBeforeRun = "";
    await withStateStore(async (store) => {
      headBeforeRun = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8" }).trim();
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionPublisher: async () => {
          publisherCalled = true;
          return {};
        },
      });
      expect(result.kind).toBe("complete");
    });

    expect(publisherCalled).toBe(false);
    // The completion commit carries real changes vs its parent (the revert), so it stays on the
    // branch instead of being unwound into the working tree.
    const headAfterRun = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8" }).trim();
    expect(headAfterRun).not.toBe(headBeforeRun);
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: workspace, encoding: "utf8" }).trim()).toBe("");
  });

  test("pipeline implement stage shape creates the draft PR when the shrink produces no further commit", async () => {
    const { step } = noWorkShrinkStep("shrink-over-existing-content-pipeline", true);
    step.skipReadyFinalization = true;
    let publisherCalled = false;
    let readyFinalizerCalled = false;

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionPublisher: async () => {
          publisherCalled = true;
          return {};
        },
        readyFinalizer: async () => {
          readyFinalizerCalled = true;
        },
      });
      expect(result.kind).toBe("complete");
    });

    expect(publisherCalled).toBe(true);
    expect(readyFinalizerCalled).toBe(false);
  });

  /**
   * A branch one commit ahead of `baseRef`, with `implement` and `implement~shrink` durable rows
   * both seeded `completed` and carrying no `completionAgent` — the re-dispatch shape that leaves
   * the completion boundary unattributed while the branch already carries real, attributed commits.
   */
  function unattributedBoundaryStep(
    branchName: string,
    trailer: string | undefined,
  ): { workspace: string; step: WriteWorkflowStep } {
    const workspace = initGitWorkspace(`unattributed-boundary-${branchName}-`);
    const baseRef = commitBaseRef(workspace, "base.txt", "base\n");

    writeFileSync(join(workspace, "feature.txt"), "feature\n", "utf8");
    execFileSync("git", ["add", "."], { cwd: workspace });
    execFileSync("git", ["commit", "-q", "-F", "-"], {
      cwd: workspace,
      input: trailer !== undefined ? `add feature\n\n${trailer}\n` : "add feature\n",
    });

    const step = createStep({ stepId: "implement", role: "implement", branchName });
    step.worktree = {
      projectRoot: workspace,
      projectName: "demo",
      branchName,
      baseRef,
      git: false,
      localPath: workspace,
    };
    step.withExternalWorktree = externalWorktreeBinding(workspace);
    return { workspace, step };
  }

  function seedCompletedWriteRunWithoutAgent(
    store: ReturnType<typeof openStateStore>,
    step: WriteWorkflowStep,
    workspace: string,
    invocationId: string,
  ): void {
    const runId = store.createRun({
      project: step.worktree.projectName,
      specRef: "",
      worktreePath: workspace,
      branch: step.worktree.branchName,
      specPath: step.specPath,
      stepId: step.stepId,
      workflowSnapshot: {
        invocationId,
        steps: [
          {
            stepId: step.stepId,
            role: step.role,
            stepRules: step.stepRules,
            expectedArtifactPath: step.expectedArtifactPath,
            agents: step.agents,
            agentModelConfig: step.agentModelConfig,
          },
        ],
      },
    });
    const attemptId = store.recordAttemptStart(runId);
    store.commitCompletionBoundary({ attemptId, runStatus: "completed", outcomeKind: "done" });
  }

  /** Seed the completed `implement` row and its hidden `implement~shrink` sibling, both unattributed. */
  function seedUnattributedCompletionRows(
    store: ReturnType<typeof openStateStore>,
    step: WriteWorkflowStep,
    workspace: string,
    invocationPrefix: string,
  ): void {
    seedCompletedWriteRunWithoutAgent(store, step, workspace, `${invocationPrefix}-inv`);
    seedCompletedWriteRunWithoutAgent(
      store,
      { ...step, stepId: "implement~shrink", role: "shrink" },
      workspace,
      `${invocationPrefix}-inv-shrink`,
    );
  }

  test("unattributed completion boundary publishes under the branch commit attribution", async () => {
    // @mutate v2/src/execution/workflow-runner.ts "? await branchCommitAgent(completionStep)" -> "? boundaryAgent"
    const branchName = "unattributed-boundary-attributed";
    const { workspace, step } = unattributedBoundaryStep(branchName, "Jarvis-Agent: claude");
    const commitCalls: string[] = [];
    let publisherCalls = 0;

    await withStateStore(async (store) => {
      seedUnattributedCompletionRows(store, step, workspace, "unattributed-boundary");

      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async (input) => {
          commitCalls.push(input.agent);
          return { commitSha: "commit-1" };
        },
        completionPublisher: async () => {
          publisherCalls += 1;
          return {};
        },
        readyFinalizer: async () => {},
      });
      expect(result.kind).toBe("complete");
    });

    expect(commitCalls).toEqual(["claude"]);
    expect(publisherCalls).toBe(1);
  });

  test("a branch whose commits carry no Jarvis-Agent trailer resolves no publishing identity", async () => {
    // @mutate v2/src/execution/workflow-runner.ts "find((agent) => agent.length > 0)" -> "find((agent) => agent.length === 0)"
    // A no-break-space trailer value trims to "" in JS but is not the empty string to git, so the
    // trailer line survives into `jarvisAgentTrailers` as a genuine "" element instead of being
    // dropped entirely (an absent trailer yields `[]`, over which both the real and mutated
    // `find` predicates return `undefined` — no divergence to catch).
    const branchName = "unattributed-boundary-untrailered";
    const { workspace, step } = unattributedBoundaryStep(branchName, `Jarvis-Agent: \u00A0`);
    let committerCalled = false;
    let publisherCalled = false;

    await withStateStore(async (store) => {
      seedUnattributedCompletionRows(store, step, workspace, "unattributed-boundary-untrailered");

      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => {
          committerCalled = true;
          return { commitSha: "commit-1" };
        },
        completionPublisher: async () => {
          publisherCalled = true;
          return {};
        },
        readyFinalizer: async () => {},
      });
      expect(result.kind).toBe("complete");
    });

    expect(committerCalled).toBe(false);
    expect(publisherCalled).toBe(false);
  });
});
