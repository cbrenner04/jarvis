import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvocationResult } from "../../../shared/invocation/execute.ts";
import { implementReviewPromptProfile } from "../../../shared/prompts/review-implement.ts";
import { withStateStore } from "../testing/write-fixtures.ts";
import { createCompletionCommitter } from "./completion-commit.ts";
import {
  createDebateBindingFactory,
  createDebateStep,
  createShrinkTestStep,
  DEBATE_AGENT_MODEL_CONFIG,
  initGitWorkspace,
  REVIEW_MD_LINT_FIXTURES,
  skipReviewWithoutHarnessMarkdownlint,
  TestLogSink,
  writeLintCleanPlanStage,
} from "./workflow-runner.test-support.ts";
import type { InvocationFailureKind } from "./invocation-failure.ts";
import { executeWorkflow, type ReviewDebateWorkflowStep } from "./workflow-runner.ts";
import {
  discardEphemeralReviewVerdictDrift,
  isPostCommitReviewRetryableFailureKind,
  revalidateStagedPlanContract,
} from "./workflow-runner-debate-landing.ts";

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
      const settled = store.loadRun(result.runId);
      expect(settled?.terminalCause).toBe("invocation_failure");
      expect(settled?.terminalFailureDetail).toMatchObject({
        failureKind: "landing",
        bindingAttempts: [],
        message: expect.stringMatching(/.+/),
      });
      const finalizationEvents = logSink
        .getEventsForRun(result.runId)
        .filter((event) => event.kind === "intent_finalization");
      expect(finalizationEvents.length).toBeGreaterThan(0);
      expect((finalizationEvents.at(-1) as { stopReason?: string }).stopReason).toBeTruthy();
      // Mutation checkpoint: finishReviewDebateLanding must not emit landing_failed loop_finished for invocation_failure.
      // @mutate v2/src/execution/workflow-runner-debate-landing.ts 'if (landingFailure.kind === "landing_failed")' -> 'if (landingFailure.kind !== "landing_failed")'
      expect(
        logSink
          .getEventsForRun(result.runId)
          .some((event) => event.kind === "loop_finished" && event.loopOutcomeKind === "landing_failed"),
      ).toBe(false);
    });
    expect(existsSync(join(stage, "example.md"))).toBe(true);
  });

  test("finishReviewDebateLanding emits loop_finished when staged markdown lint budget exhausts landing_failed", async () => {
    // @mutate v2/src/execution/workflow-runner-debate-landing.ts 'if (landingFailure.kind === "landing_failed")' -> 'if (landingFailure.kind !== "landing_failed")'
    if (
      skipReviewWithoutHarnessMarkdownlint(
        "finishReviewDebateLanding emits loop_finished when staged markdown lint budget exhausts landing_failed",
      )
    ) {
      return;
    }

    const root = mkdtempSync(join(tmpdir(), "debate-landing-md-lint-exhaust-"));
    const stage = join(root, ".jarvis-plan-stage");
    const durable = join(root, "spec", "2026-debate-landing-md-lint-exhaust");
    const violationBytes = readFileSync(join(REVIEW_MD_LINT_FIXTURES, "plan-md038-violation-subspec.md"), "utf8");
    writeLintCleanPlanStage(stage);

    const step = createDebateStep({
      stepId: "review-debate-landing-md-lint-exhaust",
      cwd: root,
      branch: "debate-landing-md-lint-exhaust",
      verdictPath: join(stage, "verdict-plan.md"),
      landing: { kind: "plan-tree", stagingDir: ".jarvis-plan-stage", durablePath: durable },
      stagedMarkdownLintMaxReprompts: 2,
      createBinding: ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
        metadata: { agent: agentId, model: adapterModel },
        invoke: async ({ cwd }) => {
          if (adapterModel === "ACT") {
            writeFileSync(join(cwd, ".jarvis-plan-stage", "00-one.md"), violationBytes, "utf8");
            return { kind: "ok", stdout: "done", stderr: "" };
          }
          return adapterModel === "ADJ"
            ? ({ kind: "ok", stdout: "apply fix", stderr: "" } as const)
            : ({ kind: "ok", stdout: "ok", stderr: "" } as const);
        },
      }),
    });

    const logSink = new TestLogSink();
    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store, logSink });
      expect(result.kind).toBe("landing_failed");
      expect(result.resumable).toBe(true);
      expect(store.loadRun(result.runId)?.attempts.at(-1)?.outcomeKind).toBe("landing_failed");
      expect(logSink.getEventsForRun(result.runId).at(-1)).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "landing_failed",
        resumable: true,
      });
    });
  });

  function createPatchReviewDebateStep(args: {
    branchName: string;
    jarvisRoot: string;
    verdictPath: string;
    cwd: string;
    createBinding?: ReviewDebateWorkflowStep["createBinding"];
    roleTimeoutMs?: number;
    idleOutputMs?: number;
    maxCycles?: number;
  }): ReviewDebateWorkflowStep {
    return {
      behavior: "review-debate",
      stepId: "implement-review",
      project: "demo",
      branch: args.branchName,
      cwd: args.cwd,
      prompts: {
        adversary: "implement.prompt.review.adversary",
        advocate: "implement.prompt.review.advocate",
        adjudicator: "implement.prompt.review.adjudicator",
      },
      verdictPath: args.verdictPath,
      maxCycles: args.maxCycles ?? 1,
      agents: { adversary: ["claude"], advocate: ["claude"], adjudicator: ["claude"], actuator: ["claude"] },
      agentModelConfig: DEBATE_AGENT_MODEL_CONFIG,
      profile: implementReviewPromptProfile,
      profileContext: { specPath: "index.md", cwd: args.cwd, baseBranch: "HEAD", passNumber: 1, totalPasses: 1 },
      ...(args.roleTimeoutMs !== undefined ? { roleTimeoutMs: args.roleTimeoutMs } : {}),
      ...(args.idleOutputMs !== undefined ? { idleOutputMs: args.idleOutputMs } : {}),
      ...(args.createBinding !== undefined ? { createBinding: args.createBinding } : {}),
    };
  }

  function createTrackedReviewDebateBindingFactory(
    calls: string[],
    actuatorFailureKind: "timeout" | "stall" | undefined,
    actuatorPrompts?: string[],
  ): NonNullable<ReviewDebateWorkflowStep["createBinding"]> {
    return ({ agentId, adapterModel }: { agentId: string; adapterModel: string }) => ({
      id: `${agentId}/${adapterModel}`,
      metadata: { agent: agentId, model: adapterModel },
      invoke: ({ signal, prompt }) => {
        calls.push(adapterModel);
        if (adapterModel === "ACT") actuatorPrompts?.push(prompt);
        if (adapterModel !== "ACT") {
          return Promise.resolve(
            adapterModel === "ADJ"
              ? ({ kind: "ok", stdout: "apply this fix", stderr: "" } as const)
              : ({ kind: "ok", stdout: "ok", stderr: "" } as const),
          );
        }
        if (actuatorFailureKind === "stall") {
          return Promise.resolve({ kind: "stall", stderr: "no output" } as const);
        }
        if (actuatorFailureKind === "timeout") {
          return new Promise<InvocationResult>((resolve) => {
            signal?.addEventListener("abort", () => resolve({ kind: "error", exitCode: 1, stderr: "aborted" }), {
              once: true,
            });
          });
        }
        return Promise.resolve({ kind: "ok", stdout: "actuated", stderr: "" } as const);
      },
    });
  }

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
        jarvisRoot: implementStep.worktree.jarvisRoot ?? "",
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
      jarvisRoot: implementStep.worktree.jarvisRoot ?? "",
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
      jarvisRoot: implementStep.worktree.jarvisRoot ?? "",
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
      const debateProgress: string[] = [];
      const firstResult = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: createCompletionCommitter(),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
        onReviewDebateProgress: (_invocationId, _stepId, update) => {
          debateProgress.push(`${update.status}:${update.role}`);
        },
      });
      expect(firstResult).toMatchObject({ kind: "invocation_failure", stepIndex: 1, resumable: false });
      expect(debateCalls).toEqual(["ADV"]);
      // @mutate v2/src/execution/workflow-runner-debate-landing.ts 'lastCycle?.kind === "role_failed" ? lastCycle.failedRole : lastCycle?.actuatorRan ? "actuator" : "adjudicator"' -> 'lastCycle?.kind !== "role_failed" ? lastCycle.failedRole : lastCycle?.actuatorRan ? "actuator" : "adjudicator"'
      expect(debateProgress.at(-1)).toBe("stopped:adversary");
      expect(store.loadRun(firstResult.runId)?.attempts.at(-1)?.invocationFailureDetail?.role).toBe("adversary");

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
      jarvisRoot: implementStep.worktree.jarvisRoot ?? "",
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
      // @mutate v2/src/execution/workflow-runner-debate-landing.ts 'lastCycle?.kind === "role_failed" ? lastCycle.failureKind : undefined' -> 'lastCycle?.kind !== "role_failed" ? lastCycle.failureKind : undefined'
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

  test("attributes a delayed debate review publication to its last mutating pass", async () => {
    // @mutate v2/src/execution/workflow-runner-debate-landing.ts "for (let index = cycles.length - 1; index >= 0; index -= 1)" -> "for (let index = cycles.length - 1; index < 0; index -= 1)"
    const branchName = "debate-review-delayed-attribution";
    const { harness, step: implementStep } = createShrinkTestStep(branchName, async ({ cwd, shrink }) => {
      if (!shrink) writeFileSync(join(cwd, "proof.txt"), "implemented\n", "utf8");
      return { kind: "ok", stdout: "done", stderr: "" };
    });
    const worktreePath = harness.workspace;
    let adjCalls = 0;
    const reviewStep = createPatchReviewDebateStep({
      branchName,
      jarvisRoot: implementStep.worktree.jarvisRoot ?? "",
      verdictPath: join(worktreePath, "verdict-patch.md"),
      cwd: worktreePath,
      maxCycles: 2,
      createBinding: ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
        invoke: async () => {
          if (adapterModel === "ADJ") {
            adjCalls += 1;
            if (adjCalls === 1) {
              return { kind: "ok", stdout: "apply this fix", stderr: "" } as const;
            }
            return { kind: "ok", stdout: "", stderr: "" } as const;
          }
          return { kind: "ok", stdout: "done", stderr: "" } as const;
        },
        metadata: { agent: adapterModel === "ACT" ? "pass-1-actuator" : agentId, model: adapterModel },
      }),
    });
    reviewStep.profileContext = {
      specPath: "spec.md",
      cwd: reviewStep.cwd,
      baseBranch: "HEAD",
      passNumber: 1,
      totalPasses: 2,
    };

    const commits: Array<{ title: string; step: unknown; agent: string }> = [];
    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: async (input) => {
          commits.push({ title: input.title, step: input.step, agent: input.agent });
          return { commitSha: "review-commit", filesChanged: 1 };
        },
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(result).toMatchObject({ kind: "complete", commitSha: "review-commit" });
      expect(commits.at(-1)).toEqual({
        title: "review-debate(1): spec.md",
        step: { kind: "review-debate", pass: 1 },
        agent: "pass-1-actuator",
      });
    });
  });

  test("discardEphemeralReviewVerdictDrift restores tracked verdict edits in git worktrees", async () => {
    // @mutate v2/src/execution/workflow-runner-debate-landing.ts "if (!existsSync(join(worktreePath, \".git\"))) return;" -> "if (existsSync(join(worktreePath, \".git\"))) return;"
    const worktreePath = initGitWorkspace("debate-landing-verdict-drift-");
    const verdictPath = join(worktreePath, "verdict-patch.md");
    writeFileSync(verdictPath, "committed\n", "utf8");
    execFileSync("git", ["add", verdictPath], { cwd: worktreePath });
    execFileSync("git", ["commit", "-qm", "seed verdict"], { cwd: worktreePath });
    writeFileSync(verdictPath, "ephemeral drift\n", "utf8");

    await discardEphemeralReviewVerdictDrift(worktreePath, verdictPath);

    expect(readFileSync(verdictPath, "utf8")).toBe("committed\n");
  });

  test("post-commit review retryability settle admits non-exhausted timeout and stall", () => {
    // @mutate v2/src/execution/workflow-runner-debate-landing.ts 'return detail.failureKind === "timeout" && !isExhaustedRoleTimeout(detail);' -> 'return detail.failureKind !== "timeout" && !isExhaustedRoleTimeout(detail);'
    for (const failureKind of ["timeout", "stall"] as const) {
      expect(isPostCommitReviewRetryableFailureKind({ failureKind })).toBe(true);
    }
    const timeoutOnly = (failureKind: InvocationFailureKind) => failureKind === "timeout";
    expect(isPostCommitReviewRetryableFailureKind({ failureKind: "stall" })).not.toBe(timeoutOnly("stall"));
    expect(isPostCommitReviewRetryableFailureKind({ failureKind: "error" })).toBe(false);
    expect(isPostCommitReviewRetryableFailureKind({ failureKind: "timeout", exhaustedRoleTimeout: true })).toBe(false);
  });

  test("revalidateStagedPlanContract returns draft shape failures before landing checks", () => {
    // @mutate v2/src/execution/workflow-runner-debate-landing.ts "if (!draft.ok) return draft;" -> "if (draft.ok) return draft;"
    const emptyStage = mkdtempSync(join(tmpdir(), "revalidate-plan-empty-"));
    const emptyResult = revalidateStagedPlanContract(emptyStage);
    expect(emptyResult.ok).toBe(false);
    if (!emptyResult.ok) expect(emptyResult.reason).toBe("plan.draft.shape");
  });

  test("revalidateStagedPlanContract runs landing checks after draft validation passes", () => {
    // @mutate v2/src/execution/workflow-runner-debate-landing.ts "if (!draft.ok) return draft;" -> "if (draft.ok) return draft;"
    const stage = mkdtempSync(join(tmpdir(), "revalidate-plan-missing-intent-"));
    mkdirSync(stage, { recursive: true });
    writeFileSync(join(stage, "index.md"), "# Index\n\n- [ ] [One](./00-one.md)\n", "utf8");
    writeFileSync(join(stage, "00-one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] x\n", "utf8");

    const result = revalidateStagedPlanContract(stage);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("staged spec tree has invalid shape");
  });

  test("finishReviewDebateLanding reprompts staged markdown lint only when the last cycle completed with actuator", async () => {
    // @mutate v2/src/execution/workflow-runner-debate-landing.ts 'lastCycle?.kind === "completed" && lastCycle.actuatorRan' -> 'lastCycle?.kind !== "completed" && lastCycle.actuatorRan'
    if (
      skipReviewWithoutHarnessMarkdownlint(
        "finishReviewDebateLanding reprompts staged markdown lint only when the last cycle completed with actuator",
      )
    ) {
      return;
    }

    const root = mkdtempSync(join(tmpdir(), "debate-landing-md-lint-reprompt-"));
    const stage = join(root, ".jarvis-plan-stage");
    const durable = join(root, "spec", "2026-debate-landing-md-lint-reprompt");
    const violationBytes = readFileSync(join(REVIEW_MD_LINT_FIXTURES, "plan-md038-violation-subspec.md"), "utf8");
    const cleanSubspec = readFileSync(join(REVIEW_MD_LINT_FIXTURES, "plan-md038-clean-subspec.md"), "utf8");
    writeLintCleanPlanStage(stage);
    let actuatorInvocations = 0;

    const step = createDebateStep({
      stepId: "review-debate-landing-md-lint-reprompt",
      cwd: root,
      branch: "debate-landing-md-lint-reprompt",
      verdictPath: join(stage, "verdict-plan.md"),
      landing: { kind: "plan-tree", stagingDir: ".jarvis-plan-stage", durablePath: durable },
      stagedMarkdownLintMaxReprompts: 2,
      createBinding: ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
        metadata: { agent: agentId, model: adapterModel },
        invoke: async ({ cwd }) => {
          if (adapterModel === "ACT") {
            actuatorInvocations += 1;
            const stageDir = join(cwd, ".jarvis-plan-stage");
            if (actuatorInvocations === 1) {
              writeFileSync(join(stageDir, "00-one.md"), violationBytes, "utf8");
            } else {
              writeFileSync(join(stageDir, "00-one.md"), cleanSubspec, "utf8");
            }
            return { kind: "ok", stdout: "done", stderr: "" };
          }
          return adapterModel === "ADJ"
            ? ({ kind: "ok", stdout: "apply fix", stderr: "" } as const)
            : ({ kind: "ok", stdout: "ok", stderr: "" } as const);
        },
      }),
    });

    const logSink = new TestLogSink();
    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store, logSink });
      expect(result.kind).toBe("complete");
      expect(actuatorInvocations).toBe(2);
      expect(existsSync(join(durable, "00-one.md"))).toBe(true);
      expect(
        logSink.getEventsForRun(result.runId).find((event) => event.kind === "staged_markdown_lint_reprompt"),
      ).toMatchObject({
        kind: "staged_markdown_lint_reprompt",
        ruleId: "MD038",
        offendingFile: ".jarvis-plan-stage/00-one.md",
      });
    });
  });
});
