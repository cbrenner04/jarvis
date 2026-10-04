import { describe, expect, mock, setSystemTime, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InvocationBinding } from "../shared/invocation/execute.ts";
import { composeRunOperatorError } from "../daemon/run-operator-error.ts";
import type { LoopFinishedEvent, PersistedRecord } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { simulatedBindings } from "../testing/bindings.ts";
import { stubAgentModelConfig } from "../testing/cli-test-helpers.ts";
import { createFakeWithExternalWorktree, createJarvisHome } from "../testing/write-fixtures.ts";
import { createCompletionCommitter } from "./completion-commit.ts";
import { createCompletionPublisher } from "./completion-publisher.ts";
import { verifyDiffDerivedMutations } from "./diff-derived-mutation-verifier.ts";
import {
  createReadyFinalizer,
  NonTerminatingMutationError,
  ReadyFlipError,
  ReadyGateError,
  RuntimeSmokeFailedError,
  SurvivingMutationError,
} from "./ready-finalize.ts";
import type { SmokePass } from "./runtime-smoke-verifier.ts";
import { resolveCompletionCommitFailedResumeContext } from "./workflow-runner-resume.ts";
import {
  CLEAN_MARKDOWNLINT_RUNNER,
  createHeldInvocation,
  gitIn,
  IN_LOOP_NON_TERMINATING_MUTATION,
  IN_LOOP_NON_TERMINATING_SOURCE_FILE,
  IN_LOOP_NON_TERMINATING_SOURCE_LINE,
  IN_LOOP_SURVIVING_MUTATION,
  IN_LOOP_SURVIVING_SOURCE_FILE,
  IN_LOOP_SURVIVING_SOURCE_LINE,
  initMutationRepairGitWorktree,
  iterationStartsBeforeLoopFinished,
  loadRunOnce,
  loadWorkBoundaryRows,
  loopOutcomeKinds,
  mockVerifyPass,
  mutationRepairSessionAttempts,
  PLAN_DRAFT_INTENT_SEED,
  PLAN_DRAFT_SPEC_PATH,
  publicationSurvivor,
  publishSurvivingMutation,
  registerWriteLoopExecuteWriteMockHooks,
  roots,
  runLoop,
  SHRINK_LOOP_TEST_PLACEHOLDERS,
  storeObservingCompletedWrites,
  TestLogSink,
} from "./write-loop.test-support.ts";
import {
  appendRuntimeSmokeOutcome,
  executeWriteLoop,
  isKillingTestWeakened,
  isShrinkWriteLoop,
  MAX_MUTATION_REPAIR_ATTEMPTS,
  publishCompletionArtifacts,
  publishWithReadyRepair,
  readyGateRepairLogFields,
  resolvePreShrinkHead,
  runMutationRepairIteration,
  runsInLoopDiffDerivedMutationVerification,
} from "./write-loop.ts";

describe("write loop", () => {
  registerWriteLoopExecuteWriteMockHooks();

  describe("work_boundary_recorded telemetry", () => {
    const completionHooks = {
      completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 2 }),
      completionPublisher: async () => ({}),
      readyFinalizer: async () => {},
    };

    test("appends one row when a completion commit succeeds", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const telemetryPath = join(jarvisRoot, "boundary-telemetry.jsonl");
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        telemetry: { sinkPath: telemetryPath, operatorSessionId: "session-1" },
        ...completionHooks,
      });

      expect(result.kind).toBe("complete");
      expect(result.commitSha).toBe("commit-abc");
      const rows = loadWorkBoundaryRows(telemetryPath);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        schema_version: 1,
        record_kind: "work_boundary_recorded",
        run_id: result.runId,
        attempt_id: result.attemptId,
        outcome_kind: "done",
        run_status: "completed",
        commit_sha: "commit-abc",
        files_changed: 2,
      });
      expect(rows[0]).not.toHaveProperty("invocation_id");
    });

    test("appends none when no telemetry block is attached", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const telemetryPath = join(jarvisRoot, "boundary-telemetry.jsonl");
      await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        ...completionHooks,
      });

      expect(loadWorkBoundaryRows(telemetryPath)).toHaveLength(0);
    });

    test("appends none when the completion commit produces no sha", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const telemetryPath = join(jarvisRoot, "boundary-telemetry.jsonl");
      await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        telemetry: { sinkPath: telemetryPath, operatorSessionId: "session-1" },
        completionCommitter: async () => ({}),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(loadWorkBoundaryRows(telemetryPath)).toHaveLength(0);
    });

    test("resume-republish appends a row with the same join keys and files_changed", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const telemetryPath = join(jarvisRoot, "boundary-telemetry.jsonl");
      const branchName = "resume-boundary";
      const publish = { commitSha: "commit-1", filesChanged: 3 };

      const first = await runLoop({
        jarvisRoot,
        stateDbPath,
        branchName,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        telemetry: { sinkPath: telemetryPath, operatorSessionId: "session-1" },
        completionCommitter: async () => publish,
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });
      expect(first.kind).toBe("complete");
      mkdirSync(join(jarvisRoot, "worktrees", "demo", branchName, ".git"), { recursive: true });

      const retry = await runLoop({
        jarvisRoot,
        stateDbPath,
        branchName,
        bindings: [],
        telemetry: { sinkPath: telemetryPath, operatorSessionId: "session-1" },
        completionCommitter: async () => publish,
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });
      expect(retry.kind).toBe("complete");

      const rows = loadWorkBoundaryRows(telemetryPath);
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows[0]?.attempt_id).toBe(rows[1]?.attempt_id);
      expect(rows[0]?.outcome_kind).toBe(rows[1]?.outcome_kind);
      expect(rows[0]?.run_status).toBe(rows[1]?.run_status);
      expect(rows[0]?.files_changed).toBe(rows[1]?.files_changed);
    });

    test("append failure leaves boundary control flow and persistence unchanged", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const telemetryDir = join(jarvisRoot, "boundary-telemetry-dir");
      mkdirSync(telemetryDir, { recursive: true });
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        telemetry: { sinkPath: telemetryDir, operatorSessionId: "session-1" },
        ...completionHooks,
      });

      expect(result.kind).toBe("complete");
      expect(result.commitSha).toBe("commit-abc");
      expect(result.boundaryTelemetryFailure).toBeDefined();
      const run = loadRunOnce(stateDbPath, result.runId);
      expect(run?.status).toBe("completed");
      expect(run?.attempts[0]?.outcomeKind).toBe("done");
    });
  });

  describe("ready finalization", () => {
    const completionHooks = {
      completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 1 }),
      completionPublisher: async () => ({}),
      runFixCommand: async () => {},
    };

    test("passes the configured ready command to the ready finalizer", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      let observedReadyCommand: string | undefined;
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        ...completionHooks,
        readyCommand: "npm run verify",
        readyFinalizer: async (finalizeInput) => {
          observedReadyCommand = finalizeInput.readyCommand;
        },
      });

      expect(result.kind).toBe("complete");
      expect(observedReadyCommand).toBe("npm run verify");
    });

    test("passes the published PR number to the ready finalizer", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      let observedPrNumber: number | undefined;
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        ...completionHooks,
        completionPublisher: async () => ({ prNumber: 99 }),
        readyFinalizer: async (finalizeInput) => {
          observedPrNumber = finalizeInput.prNumber;
        },
      });

      expect(result.kind).toBe("complete");
      expect(observedPrNumber).toBe(99);
    });

    test("publishWithReadyRepair records harness ready-flip evidence on the write-loop run row", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const store = openStateStore(stateDbPath);
      const branchName = "ready-flip-evidence";
      const baseRef = "main";
      const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
      mkdirSync(worktreePath, { recursive: true });
      const runId = store.createRun({
        project: "demo",
        specRef: baseRef,
        worktreePath,
        branch: branchName,
        specPath: "spec.md",
      });
      const readyFinalizer = createReadyFinalizer({
        runReadyGate: async () => {},
        ghReadyFlip: async () => {},
      });

      try {
        setSystemTime(new Date(18_000));
        const publication = await publishWithReadyRepair(
          {
            worktree: {
              projectRoot: "/fake",
              projectName: "demo",
              branchName,
              baseRef,
              jarvisRoot,
            },
            specPath: "spec.md",
            promptId: "plan.prompt.draft",
            stepRules: "rules",
            expectedArtifactPath: "proof.txt",
            bindings: [],
            stateStore: store,
            withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
            sessionsDir: join(jarvisRoot, "sessions"),
            maxIterations: 0,
            completionPublisher: async () => ({ prNumber: 77 }),
            readyFinalizer,
          },
          store,
          { kind: "complete", runId, iterationsConsumed: 0, resumable: false, completionAgent: "codex" },
          0,
          {
            worktreePath,
            baseRef,
            specPath: "spec.md",
            branch: branchName,
          },
        );

        expect(publication.failure).toBeUndefined();
        expect(
          store.findNewestHarnessReadyFlipEvidenceInLineage({
            project: "demo",
            branch: branchName,
            specRef: baseRef,
            baseRef,
            prNumber: 77,
          }),
        ).toEqual({
          prNumber: 77,
          branch: branchName,
          baseRef,
          flippedAt: 18_000,
        });
      } finally {
        setSystemTime();
        store.close();
      }
    });

    test("publishCompletionArtifacts wires lineage lookup to undo harness-ready non-draft PRs", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const store = openStateStore(stateDbPath);
      const branchName = "harness-republication-undo";
      const baseRef = "main";
      const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
      mkdirSync(worktreePath, { recursive: true });
      const prNumber = 88;
      const runId = store.createRun({
        project: "demo",
        specRef: baseRef,
        worktreePath,
        branch: branchName,
        specPath: "spec.md",
      });
      store.recordHarnessReadyFlipEvidence({ runId, prNumber, branch: branchName, baseRef });
      let isDraft = false;
      const ghCalls: string[] = [];
      const readyFinalizer = createReadyFinalizer({
        runReadyGate: async () => {},
        ghReadyFlip: async () => {},
      });
      try {
        setSystemTime(new Date(19_000));
        const outcome = await publishCompletionArtifacts(
          {
            promptId: "plan.prompt.draft",
            readyFinalizer,
            completionPublisher: createCompletionPublisher({
              git: async (_cwd, args) => {
                if (args[0] === "rev-parse" && args.includes(`${branchName}@{u}`)) throw new Error("no upstream");
                if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
                return "";
              },
              gh: async (_cwd, args) => {
                ghCalls.push(args.join(" "));
                if (args[0] === "pr" && args[1] === "ready" && args[2] === "--undo") {
                  isDraft = true;
                  return "";
                }
                if (args[0] === "pr" && args[1] === "list") {
                  return JSON.stringify([{ number: prNumber, baseRefName: baseRef, isDraft }]);
                }
                if (args[0] === "pr" && args[1] === "view") {
                  return JSON.stringify({
                    number: prNumber,
                    url: `https://github.com/user/repo/pull/${prNumber}`,
                    baseRefName: baseRef,
                  });
                }
                return "";
              },
              delay: async () => {},
              fetchPrBody: async () => "",
              writePrBody: async () => {},
              renderFooter: async () => "",
            }),
          },
          {
            worktreePath,
            baseRef,
            specPath: "spec.md",
            branch: branchName,
          },
          undefined,
          (args) => store.recordHarnessReadyFlipEvidence({ runId, ...args }),
          { runId, store },
        );
        expect(outcome.kind).toBe("success");
        expect(ghCalls.some((call) => call === `pr ready --undo ${prNumber}`)).toBe(true);
        expect(
          store.findNewestHarnessReadyFlipEvidenceInLineage({
            project: "demo",
            branch: branchName,
            specRef: baseRef,
            baseRef,
            prNumber,
          }),
        ).toEqual({
          prNumber,
          branch: branchName,
          baseRef,
          flippedAt: 19_000,
        });
      } finally {
        setSystemTime();
        store.close();
      }
    });

    test("publishCompletionArtifacts accepts pushSha with lane_pr_closed without completion_commit_failed", async () => {
      let readyFinalizerInvoked = false;
      const input = {
        worktreePath: "/tmp/worktree",
        baseRef: "main",
        specPath: "spec.md",
        branch: "feature",
      };
      const outcome = await publishCompletionArtifacts(
        {
          completionPublisher: async () => ({
            pushSha: "abc123def456",
            lanePrOutcome: { kind: "lane_pr_closed", prNumber: 88 },
          }),
          readyFinalizer: async () => {
            readyFinalizerInvoked = true;
          },
        },
        input,
      );
      expect(outcome.kind).toBe("success");
      expect(outcome).toMatchObject({ lanePrOutcome: { kind: "lane_pr_closed", prNumber: 88 } });
      expect(readyFinalizerInvoked).toBe(false);
    });

    test("routes markdown-only workflow prompts around the ready gate", async () => {
      const calls: string[] = [];
      const readyFinalizer = createReadyFinalizer({
        runReadyGate: async () => {
          calls.push("gate");
          throw new ReadyGateError("missing-ready", undefined, "ENOENT", false, {
            kind: "ready_gate_command_missing",
          });
        },
        runMutationVerification: async () => {
          calls.push("mutation");
        },
        runRuntimeSmokeVerification: async () => {
          calls.push("smoke");
          return { kind: "observed-clean" };
        },
        ghReadyFlip: async () => {
          calls.push("flip");
        },
      });
      const input = {
        worktreePath: "/tmp/worktree",
        baseRef: "main",
        specPath: "spec.md",
        branch: "feature",
      };
      const publish = (promptId: string) =>
        publishCompletionArtifacts({ completionPublisher: async () => ({}), readyFinalizer, promptId }, input);

      await expect(publish("intent.prompt.split")).resolves.toMatchObject({ kind: "success" });
      await expect(publish("plan.prompt.draft")).resolves.toMatchObject({ kind: "success" });
      await expect(publish("implement.prompt.body")).resolves.toMatchObject({ kind: "ready_gate_command_missing" });
      expect(calls).toEqual(["mutation", "smoke", "flip", "mutation", "smoke", "flip", "gate"]);
    });

    test.each([
      { terminal: "completed", expectedKind: "complete", expectedResumable: false },
      { terminal: "failed", expectedKind: "ready_gate_failed", expectedResumable: true },
      { terminal: "killed", expectedKind: "progress", expectedResumable: true },
    ] as const)("joins a held ready repair before $terminal becomes durable", async ({
      terminal,
      expectedKind,
      expectedResumable,
    }) => {
      // Mutation checkpoint: in `settleFinalizationRepair`, skip `abortExecution()` (abort-propagation
      // guard), skip `await execution` (invocation-join guard), or in `runReadyRepairIteration` commit a
      // terminal boundary before `awaitIteration` (terminal-ordering guard).
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const store = openStateStore(stateDbPath);
      const controller = new AbortController();
      let runId: string | undefined;
      let calls = 0;
      const repair = createHeldInvocation();
      let gateCalls = 0;

      const bindings: InvocationBinding[] = [
        {
          id: "held-repair",
          metadata: { agent: "codex", model: "test" },
          invoke: ({ cwd, signal }) => {
            calls += 1;
            if (calls === 1) {
              writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
              return Promise.resolve({ kind: "ok", stdout: "done", stderr: "" });
            }
            return repair.invoke(signal);
          },
        },
      ];

      try {
        const resultPromise = executeWriteLoop({
          worktree: {
            projectRoot: "/fake",
            projectName: "demo",
            branchName: `repair-settlement-${terminal}`,
            baseRef: "HEAD",
            jarvisRoot,
          },
          specPath: "spec.md",
          stepRules: "Return exactly one terminal token.",
          expectedArtifactPath: "proof.txt",
          bindings,
          stateStore: store,
          withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
          sessionsDir: join(jarvisRoot, "sessions"),
          signal: controller.signal,
          maxIterations: 2,
          quiescenceTimeoutMs: 1,
          stagedMarkdownLintRunner: CLEAN_MARKDOWNLINT_RUNNER,
          completionCommitter: completionHooks.completionCommitter,
          completionPublisher: completionHooks.completionPublisher,
          runFixCommand: completionHooks.runFixCommand,
          readyFinalizer: async () => {
            gateCalls += 1;
            if (terminal !== "completed" || gateCalls <= 2) {
              throw new ReadyGateError("bun run ready", 1, "red");
            }
          },
          onRunCreated: (id) => {
            runId = id;
          },
        });

        await repair.started;
        expect(runId).toBeDefined();
        expect(store.loadRun(runId as string)?.status).toBe("in-progress");

        if (terminal === "killed") {
          controller.abort();
          await new Promise<void>((resolve) => setTimeout(resolve, 10));
          expect(repair.signal?.aborted).toBe(true);
          expect(store.loadRun(runId as string)?.status).toBe("in-progress");
        }

        repair.release();
        const result = await resultPromise;
        if (terminal === "killed") {
          expect(store.loadRun(runId as string)?.status).toBe("in-progress");
          store.commitGuardedKill(runId as string);
        }

        expect(result).toMatchObject({ kind: expectedKind, resumable: expectedResumable });
        expect(store.loadRun(runId as string)?.status).toBe(terminal);
        expect(repair.signal?.aborted).toBe(true);
        expect(repair.processSettled).toBe(true);
        expect(repair.invocationSettled).toBe(true);
      } finally {
        repair.release();
        store.close();
      }
    });

    test("mutation repair ignores bounded quiescence and joins a non-cooperative invocation", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const store = openStateStore(stateDbPath);
      const branchName = "mutation-repair-join";
      const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
      mkdirSync(worktreePath, { recursive: true });
      writeFileSync(join(worktreePath, "spec.md"), "# Spec\n", "utf8");
      const runId = store.createRun({
        project: "demo",
        specRef: "HEAD",
        worktreePath,
        branch: branchName,
        specPath: "spec.md",
      });
      const repair = createHeldInvocation();
      const binding: InvocationBinding = {
        id: "held-mutation-repair",
        metadata: { agent: "codex", model: "test" },
        invoke: ({ signal }) => repair.invoke(signal),
      };

      try {
        const outcomePromise = runMutationRepairIteration(
          {
            worktree: {
              projectRoot: "/fake",
              projectName: "demo",
              branchName,
              baseRef: "HEAD",
              jarvisRoot,
            },
            specPath: "spec.md",
            expectedArtifactPath: "spec.md",
            stepRules: "repair",
            bindings: [binding],
            stateStore: store,
            withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
            sessionsDir: join(jarvisRoot, "sessions"),
            iterationTimeoutMs: 1,
            quiescenceTimeoutMs: 1,
          },
          store,
          { kind: "complete", runId, iterationsConsumed: 0, resumable: false, completionAgent: "codex" },
          new SurvivingMutationError("operator-flip: === → !==", "src/guard.ts", 17, [], "not-run"),
          1,
        );

        await repair.started;
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        expect(repair.signal?.aborted).toBe(true);
        expect(store.loadRun(runId)?.status).toBe("in-progress");
        expect(repair.processSettled).toBe(false);
        expect(repair.invocationSettled).toBe(false);

        repair.release();
        expect(await outcomePromise).toBe("unsettled");
        expect(repair.processSettled).toBe(true);
        expect(repair.invocationSettled).toBe(true);
        expect(store.loadRun(runId)?.status).toBe("in-progress");
      } finally {
        repair.release();
        store.close();
      }
    });

    test("resumed publication joins its repair before restoring failed", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const store = openStateStore(stateDbPath);
      const branchName = "resumed-repair-settlement";
      const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
      mkdirSync(join(worktreePath, ".git"), { recursive: true });
      writeFileSync(join(worktreePath, "proof.txt"), "ok\n", "utf8");
      const runId = store.createRun({
        project: "demo",
        specRef: "HEAD",
        worktreePath,
        branch: branchName,
        specPath: "spec.md",
      });
      const attemptId = store.recordAttemptStart(runId);
      store.commitCompletionBoundary({
        attemptId,
        runStatus: "completed",
        outcomeKind: "done",
        completionAgent: "codex",
      });
      const repair = createHeldInvocation();

      try {
        const resultPromise = executeWriteLoop({
          worktree: {
            projectRoot: "/fake",
            projectName: "demo",
            branchName,
            baseRef: "HEAD",
            jarvisRoot,
          },
          specPath: "spec.md",
          stepRules: "repair",
          expectedArtifactPath: "proof.txt",
          bindings: [
            {
              id: "held-resume-repair",
              metadata: { agent: "codex", model: "test" },
              invoke: ({ signal }) => repair.invoke(signal),
            },
          ],
          stateStore: store,
          withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
          sessionsDir: join(jarvisRoot, "sessions"),
          maxIterations: 1,
          stagedMarkdownLintRunner: CLEAN_MARKDOWNLINT_RUNNER,
          completionCommitter: completionHooks.completionCommitter,
          completionPublisher: completionHooks.completionPublisher,
          readyFinalizer: async () => {
            throw new ReadyGateError("bun run ready", 1, "red");
          },
        });

        await repair.started;
        expect(store.loadRun(runId)?.status).toBe("in-progress");
        repair.release();
        expect(await resultPromise).toMatchObject({ kind: "ready_gate_failed", resumable: true });
        expect(store.loadRun(runId)?.status).toBe("failed");
        expect(repair.signal?.aborted).toBe(true);
        expect(repair.processSettled).toBe(true);
        expect(repair.invocationSettled).toBe(true);
      } finally {
        repair.release();
        store.close();
      }
    });

    test("runs ready finalization only after publication succeeds", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const calls: string[] = [];
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        completionCommitter: completionHooks.completionCommitter,
        completionPublisher: async () => {
          calls.push("publish");
          return {};
        },
        readyFinalizer: async () => {
          calls.push("finalize");
        },
      });

      expect(result.kind).toBe("complete");
      expect(calls).toEqual(["publish", "finalize"]);
    });

    test("returns retryable ready_gate_failed when the gate fails and does not call the flip", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        maxIterations: 1,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        logSink,
        ...completionHooks,
        readyFinalizer: async () => {
          throw new ReadyGateError("bun run ready", 1, "tests failed");
        },
      });

      expect(result.kind).toBe("ready_gate_failed");
      expect(result.resumable).toBe(true);
      expect(result.readyGateError).toContain("ready gate failed");
      expect(logSink.getEventsForRun(result.runId).at(-1)).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "ready_gate_failed",
        resumable: true,
        readyGateCommand: "bun run ready",
        readyGateOutput: "tests failed",
      });
    });

    test("ready gate terminal evidence truncates oversized output to its tail", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      const discardedPrefix = "discarded-prefix-".repeat(300);
      const retainedTail = "terminal-diagnostic-".repeat(256).slice(-4096);
      const oversizedOutput = `  ${discardedPrefix}${retainedTail}  `;
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        logSink,
        ...completionHooks,
        readyFinalizer: async () => {
          throw new ReadyGateError("bun run configured-ready", 1, oversizedOutput);
        },
      });

      const terminal = logSink.getEventsForRun(result.runId).at(-1);
      expect(terminal).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "ready_gate_failed",
        readyGateCommand: "bun run configured-ready",
        readyGateOutput: oversizedOutput.trim().slice(-4096),
      });
      expect((terminal as { readyGateOutput?: string } | undefined)?.readyGateOutput).toHaveLength(4096);
      expect(JSON.stringify(terminal)).not.toContain(discardedPrefix);
      expect(JSON.stringify(terminal)).not.toContain(oversizedOutput);
    });

    test("repairs a red ready gate through a write iteration", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      let gateCalls = 0;
      let invocations = 0;
      const prompts: string[] = [];
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: [
          {
            id: "sim.1",
            metadata: { agent: "sim-agent-1", model: "sim-model-1" },
            invoke: async ({ prompt, cwd }) => {
              invocations += 1;
              prompts.push(prompt);
              writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
              return { kind: "ok", stdout: "done", stderr: "" } as const;
            },
          },
        ],
        logSink,
        completionCommitter: completionHooks.completionCommitter,
        completionPublisher: completionHooks.completionPublisher,
        runFixCommand: completionHooks.runFixCommand,
        readyFinalizer: async () => {
          gateCalls += 1;
          if (invocations === 1) throw new ReadyGateError("bun run ready", 1, "tests failed");
        },
      });

      expect(result.kind).toBe("complete");
      expect(gateCalls).toBe(3);
      expect(prompts).toHaveLength(2);
      expect(prompts[1]).toContain("Command: bun run ready");
      expect(prompts[1]).toContain("Exit code: 1");
      expect(prompts[1]).toContain("tests failed");
      expect(logSink.getEventsForRun(result.runId)).toContainEqual({
        kind: "ready_gate_repair",
        attempt: 1,
        gateExitCode: 1,
        ...readyGateRepairLogFields("bun run ready", "tests failed"),
      });
    });

    test("caps red-gate repairs at three attempts", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      let gateCalls = 0;
      let invocations = 0;
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: [
          {
            id: "sim.1",
            metadata: { agent: "sim-agent-1", model: "sim-model-1" },
            invoke: async ({ cwd }) => {
              invocations += 1;
              writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
              return { kind: "ok", stdout: "done", stderr: "" } as const;
            },
          },
        ],
        logSink,
        ...completionHooks,
        readyFinalizer: async () => {
          gateCalls += 1;
          throw new ReadyGateError("bun run ready", 2, `failure ${gateCalls}`);
        },
      });

      expect(result.kind).toBe("ready_gate_failed");
      expect(result.resumable).toBe(true);
      expect(invocations).toBe(4);
      expect(gateCalls).toBe(5);
      const events = logSink.getEventsForRun(result.runId);
      expect(events.filter((event) => event.kind === "iteration_started")).toHaveLength(4);
      expect(events.filter((event) => event.kind === "ready_gate_repair")).toHaveLength(3);
      expect(events.at(-1)).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "ready_gate_failed",
        readyGateOrigin: "repair_budget_exhausted",
        resumable: true,
      });
      expect(loadRunOnce(stateDbPath, result.runId)?.operatorFailureRecord?.retryable).toBe(true);
    });

    test("returns ready_gate_failed when the repair budget is exhausted", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      let invocations = 0;
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        maxIterations: 2,
        bindings: [
          {
            id: "sim.1",
            metadata: { agent: "sim-agent-1", model: "sim-model-1" },
            invoke: async ({ cwd }) => {
              invocations += 1;
              writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
              return { kind: "ok", stdout: "done", stderr: "" } as const;
            },
          },
        ],
        ...completionHooks,
        readyFinalizer: async () => {
          throw new ReadyGateError("bun run ready", 1, "still red");
        },
      });

      expect(result.kind).toBe("ready_gate_failed");
      expect(result.iterationsConsumed).toBe(2);
      expect(invocations).toBe(2);
    });

    test("stops repair when the agent returns blocked", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      let gateCalls = 0;
      let invocations = 0;
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: [
          {
            id: "sim.1",
            metadata: { agent: "sim-agent-1", model: "sim-model-1" },
            invoke: async ({ cwd }) => {
              invocations += 1;
              writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
              if (invocations === 2) {
                appendFileSync(join(cwd, "spec.md"), "\n## Blocker\n\nstuck\n", "utf8");
                return { kind: "ok", stdout: "blocked", stderr: "" } as const;
              }
              return { kind: "ok", stdout: "done", stderr: "" } as const;
            },
          },
        ],
        ...completionHooks,
        readyFinalizer: async () => {
          gateCalls += 1;
          throw new ReadyGateError("bun run ready", 1, "red");
        },
      });

      expect(result.kind).toBe("ready_gate_failed");
      expect(result.iterationsConsumed).toBe(2);
      expect(gateCalls).toBe(2);
      expect(invocations).toBe(2);
    });
    test("returns retryable ready_flip_failed when publication succeeded but flip fails without repair", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        ...completionHooks,
        readyFinalizer: async () => {
          throw new Error("gh pr ready failed");
        },
      });

      expect(result.kind).toBe("ready_flip_failed");
      expect(result.readyFlipError).toContain("gh pr ready failed");
    });

    test("surfaces PR number when flip failure occurs after successful publication", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({ prNumber: 99 }),
        readyFinalizer: async () => {
          throw new Error("gh pr ready failed");
        },
      });

      expect(result.kind).toBe("ready_flip_failed");
      expect(result.readyFlipPrNumber).toBe(99);
      expect(result.readyFlipError).toContain("gh pr ready failed");
    });

    test("omits PR number when flip failure occurs but publication returned no PR", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {
          throw new Error("gh pr ready failed");
        },
      });

      expect(result.kind).toBe("ready_flip_failed");
      expect(result.readyFlipPrNumber).toBeUndefined();
      expect(result.readyFlipError).toContain("gh pr ready failed");
    });

    test("lane_pr_closed publication settles complete with lanePrOutcome on loop_finished", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1", filesChanged: 1 }),
        completionPublisher: async () => ({
          pushSha: "abc123def456",
          lanePrOutcome: { kind: "lane_pr_closed", prNumber: 88 },
        }),
        readyFinalizer: async () => {
          throw new Error("should not finalize when lane PR is closed");
        },
      });

      expect(result.kind).toBe("complete");
      expect(result.prNumber).toBeUndefined();
      const loopFinished = logSink.getEventsForRun(result.runId).at(-1);
      expect(loopFinished).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "complete",
        lanePrOutcome: { kind: "lane_pr_closed", prNumber: 88 },
      });
      const storedRun = loadRunOnce(stateDbPath, result.runId);
      expect(storedRun?.status).toBe("completed");
      expect(storedRun?.terminalCause).toBe("complete");
      expect(storedRun?.prNumber).toBeNull();
    });

    test("retargeted publication base lands on loop_finished for fresh and completed-run republish", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      const branchName = "retarget-republish";
      const hooks = {
        completionCommitter: async () => ({ commitSha: "commit-1", filesChanged: 1 }),
        completionPublisher: async () => ({
          prNumber: 91,
          prUrl: "https://github.com/user/repo/pull/91",
          pushSha: "abc123def456",
          requestedBase: "plan/merged-first",
          resolvedBase: "main",
        }),
        readyFinalizer: async () => {},
      };
      const retarget = { kind: "loop_finished", requestedBase: "plan/merged-first", resolvedBase: "main" };

      const first = await runLoop({
        jarvisRoot,
        stateDbPath,
        branchName,
        logSink,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        ...hooks,
      });
      expect(first.kind).toBe("complete");
      expect(logSink.getEventsForRun(first.runId).at(-1)).toMatchObject(retarget);

      mkdirSync(join(jarvisRoot, "worktrees", "demo", branchName, ".git"), { recursive: true });
      const retryLog = new TestLogSink();
      const retry = await runLoop({ jarvisRoot, stateDbPath, branchName, logSink: retryLog, bindings: [], ...hooks });
      expect(retry.kind).toBe("complete");
      expect(retryLog.getEventsForRun(retry.runId).at(-1)).toMatchObject(retarget);
    });

    test("returns retryable completion_commit_failed when pushed without PR evidence", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1", filesChanged: 1 }),
        completionPublisher: async () => ({ pushSha: "abc123def456" }),
        readyFinalizer: async () => {
          throw new Error("should not finalize when PR evidence is missing");
        },
      });

      expect(result.kind).toBe("completion_commit_failed");
      expect(result.resumable).toBe(true);
      expect(result.completionCommitError).toContain("PR evidence");
      // Mutation checkpoint: the terminal `loop_finished` record must carry the same
      // `completionCommitError` the write loop returns, not merely permit it in the schema.
      expect(logSink.getEventsForRun(result.runId).at(-1)).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "completion_commit_failed",
        resumable: true,
        completionCommitError: result.completionCommitError,
      });
    });

    test("logs completionCommitError and publicationFailure for a real normalized publication push failure", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      const failingGit = async (_cwd: string, args: readonly string[]) => {
        if (args[0] === "push") throw new Error("failed to push some refs to origin");
        return "";
      };

      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1", filesChanged: 1 }),
        completionPublisher: createCompletionPublisher({
          git: failingGit,
          gh: async () => "",
          delay: async () => {},
        }),
        readyFinalizer: async () => {},
      });

      expect(result.kind).toBe("completion_commit_failed");
      expect(result.completionCommitError).toContain("failed to push some refs");
      expect(result.publicationFailure).toMatchObject({ operation: "push" });

      // Mutation checkpoint: the terminal `loop_finished` record must carry the same
      // `completionCommitError` and `publicationFailure` the write loop returns.
      const loopFinished = logSink.getEventsForRun(result.runId).filter((event) => event.kind === "loop_finished");
      expect(loopFinished.at(-1)).toMatchObject({
        loopOutcomeKind: "completion_commit_failed",
        completionCommitError: result.completionCommitError,
        publicationFailure: result.publicationFailure,
      });
    });

    test("completed published run's terminal loop_finished record carries PR evidence", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1", filesChanged: 1 }),
        completionPublisher: async () => ({ prNumber: 42, prUrl: "https://github.com/owner/repo/pull/42" }),
        readyFinalizer: async () => {},
      });

      expect(result.kind).toBe("complete");
      expect(result.prNumber).toBe(42);
      expect(result.prUrl).toBe("https://github.com/owner/repo/pull/42");

      const loopFinished = logSink.getEventsForRun(result.runId).at(-1);
      expect(loopFinished?.kind).toBe("loop_finished");
      if (loopFinished?.kind === "loop_finished") {
        expect(loopFinished.prNumber).toBe(42);
        expect(loopFinished.prUrl).toBe("https://github.com/owner/repo/pull/42");
      }

      const storedRun = loadRunOnce(stateDbPath, result.runId);
      expect(storedRun?.prNumber).toBe(42);
      expect(storedRun?.prUrl).toBe("https://github.com/owner/repo/pull/42");
    });

    test("fresh completion publication persists PR evidence before the run becomes completed", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const inner = openStateStore(stateDbPath);
      const { store, completedWrites } = storeObservingCompletedWrites(inner);
      const prNumber = 42;
      const prUrl = "https://github.com/owner/repo/pull/42";
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        store,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        completionCommitter: async () => ({ commitSha: "commit-1", filesChanged: 1 }),
        completionPublisher: async () => ({ prNumber, prUrl }),
        readyFinalizer: async () => {},
      });

      expect(result.kind).toBe("complete");
      const successfulCompletedWrite = completedWrites.at(-1);
      expect(successfulCompletedWrite?.prNumber).toBe(prNumber);
      expect(successfulCompletedWrite?.prUrl).toBe(prUrl);
      expect(successfulCompletedWrite?.terminalCause).toBe("complete");
      expect(successfulCompletedWrite?.finishedAt).not.toBeNull();
    });

    test("resumed completion publication persists PR evidence before the run becomes completed and reuses the published PR", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const branchName = "resume-pr-evidence-order";
      const publish = { commitSha: "commit-1", filesChanged: 2 };
      const prNumber = 7;
      const prUrl = "https://github.com/owner/repo/pull/7";
      let publishCalls = 0;

      const first = await runLoop({
        jarvisRoot,
        stateDbPath,
        branchName,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        completionCommitter: async () => publish,
        completionPublisher: async () => {
          publishCalls += 1;
          throw new Error("push failed");
        },
        readyFinalizer: async () => {
          throw new Error("should not finalize before publication succeeds");
        },
      });
      expect(first.kind).toBe("completion_commit_failed");
      expect(publishCalls).toBe(1);

      mkdirSync(join(jarvisRoot, "worktrees", "demo", branchName, ".git"), { recursive: true });

      const inner = openStateStore(stateDbPath);
      const { store, completedWrites } = storeObservingCompletedWrites(inner);
      const retry = await runLoop({
        jarvisRoot,
        stateDbPath,
        branchName,
        store,
        bindings: [],
        completionCommitter: async () => publish,
        completionPublisher: async () => {
          publishCalls += 1;
          return { prNumber, prUrl };
        },
        readyFinalizer: async () => {},
      });
      expect(retry.kind).toBe("complete");
      expect(retry.runId).toBe(first.runId);
      expect(publishCalls).toBe(2);
      expect(retry.prNumber).toBe(prNumber);
      expect(retry.prUrl).toBe(prUrl);

      const successfulCompletedWrite = completedWrites.at(-1);
      expect(successfulCompletedWrite?.prNumber).toBe(prNumber);
      expect(successfulCompletedWrite?.prUrl).toBe(prUrl);
      expect(successfulCompletedWrite?.terminalCause).toBe("complete");
      expect(successfulCompletedWrite?.finishedAt).not.toBeNull();
    });

    test("logs run_settlement_rejected when the completion settlement is rejected by a stale owner", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const store = openStateStore(stateDbPath);
      const commitTerminalRunSettlement = store.commitTerminalRunSettlement.bind(store);
      store.commitTerminalRunSettlement = (args) => {
        commitTerminalRunSettlement(args);
        return { kind: "rejected", attemptedStatus: args.status, reportingIdentity: "stale-owner:999" };
      };
      const logSink = new TestLogSink();

      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        store,
        logSink,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        completionCommitter: async () => ({ commitSha: "commit-1", filesChanged: 1 }),
        completionPublisher: async () => ({ prNumber: 42, prUrl: "https://github.com/owner/repo/pull/42" }),
        readyFinalizer: async () => {},
      });

      expect(result.kind).toBe("complete");
      const rejected = logSink.getEventsForRun(result.runId).find((event) => event.kind === "run_settlement_rejected");
      expect(rejected).toEqual({
        kind: "run_settlement_rejected",
        attemptedStatus: "completed",
        reportingIdentity: "stale-owner:999",
      });
    });

    test("landing_failed budget exhaustion settles failed with terminal cause without a second status write", async () => {
      const realLint = await import("./staged-markdown-lint.ts");
      mock.module("./staged-markdown-lint.ts", () => ({
        lintStagedMarkdown: async () => ({
          kind: "violation" as const,
          ruleId: "MD038",
          filePath: "stage/00-one.md",
          message: "spaces inside emphasis markers",
        }),
      }));
      try {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        let failedStatusWrites = 0;
        const inner = openStateStore(stateDbPath);
        const store: StateStore = {
          currentOwnerIdentity: () => inner.currentOwnerIdentity(),
          createRun: (args) => inner.createRun(args),
          setCreationTitle: (runId, title) => inner.setCreationTitle(runId, title),
          setInvocationLeaseFromSha: (invocationId, leases) => inner.setInvocationLeaseFromSha(invocationId, leases),
          setRunSpecPath: (runId, specPath) => inner.setRunSpecPath(runId, specPath),
          setRunDownstreamInputs: (runId, downstreamInputs) => inner.setRunDownstreamInputs(runId, downstreamInputs),
          clearRunDownstreamInputs: (runId) => inner.clearRunDownstreamInputs(runId),
          setPrEvidence: (runId, prNumber, prUrl) => inner.setPrEvidence(runId, prNumber, prUrl),
          setReadyGatePgid: (runId, pgid) => inner.setReadyGatePgid(runId, pgid),
          readRunBudgetConsumedMs: (budgetKey) => inner.readRunBudgetConsumedMs(budgetKey),
          writeRunBudgetConsumedMs: (budgetKey, consumedMs) => inner.writeRunBudgetConsumedMs(budgetKey, consumedMs),
          readMutationRepairAttempts: (runId) => inner.readMutationRepairAttempts(runId),
          recordMutationRepairAttempts: (runId, consumed) => inner.recordMutationRepairAttempts(runId, consumed),
          readWorkflowInvocationSettledMarker: (entryRunId) => inner.readWorkflowInvocationSettledMarker(entryRunId),
          writeWorkflowInvocationSettledMarker: (entryRunId, cause, settledAt) =>
            inner.writeWorkflowInvocationSettledMarker(entryRunId, cause, settledAt),
          recordVerifierProcessGroup: (runId, pgid) => inner.recordVerifierProcessGroup(runId, pgid),
          verifierProcessGroups: (runId) => inner.verifierProcessGroups(runId),
          clearVerifierProcessGroup: (runId, pgid) => inner.clearVerifierProcessGroup(runId, pgid),
          clearVerifierProcessGroups: (runId) => inner.clearVerifierProcessGroups(runId),
          listReadyGateSweepCandidates: () => inner.listReadyGateSweepCandidates(),
          setReadyGateRepairFence: (runId, fence) => inner.setReadyGateRepairFence(runId, fence),
          setRetainedFinalizationCheckpoint: (runId, checkpoint) =>
            inner.setRetainedFinalizationCheckpoint(runId, checkpoint),
          recordHarnessReadyFlipEvidence: (args) => inner.recordHarnessReadyFlipEvidence(args),
          findNewestHarnessReadyFlipEvidenceInLineage: (args) =>
            inner.findNewestHarnessReadyFlipEvidenceInLineage(args),
          loadRun: (runId) => inner.loadRun(runId),
          findRunByProjectBranch: (args) => inner.findRunByProjectBranch(args),
          findReviewMutationLineageRows: (args) => inner.findReviewMutationLineageRows(args),
          findRunsByInvocationId: (invocationId) => inner.findRunsByInvocationId(invocationId),
          findRunsByInvocationIds: (invocationIds) => inner.findRunsByInvocationIds(invocationIds),
          findWorkflowRunsOnLane: (args) => inner.findWorkflowRunsOnLane(args),
          loadRunsByIds: (runIds) => inner.loadRunsByIds(runIds),
          createPipeline: (args) => inner.createPipeline(args),
          createPipelineStageBranch: (args) => inner.createPipelineStageBranch(args),
          loadPipeline: (pipelineId) => inner.loadPipeline(pipelineId),
          listPipelines: () => inner.listPipelines(),
          updateStage: (args) => inner.updateStage(args),
          commitTerminalStageOperatorFailureRecord: (args) => inner.commitTerminalStageOperatorFailureRecord(args),
          loadTerminalStageOperatorFailureRecord: (args) => inner.loadTerminalStageOperatorFailureRecord(args),
          settleLinkedStagesFromEntryRun: (entryRunId) => inner.settleLinkedStagesFromEntryRun(entryRunId),
          commitApprovalBoundary: (args) => inner.commitApprovalBoundary(args),
          commitApprovalDecision: (args) => inner.commitApprovalDecision(args),
          claimPipelineContinuation: (args) => inner.claimPipelineContinuation(args),
          adoptOrphanedPipeline: (pipelineId) => inner.adoptOrphanedPipeline(pipelineId),
          pipelineOwnerIsDead: (pipelineId) => inner.pipelineOwnerIsDead(pipelineId),
          claimPipelineStageAdmission: (args) => inner.claimPipelineStageAdmission(args),
          releasePipelineStageAdmission: (args) => inner.releasePipelineStageAdmission(args),
          loadPipelineStageAdmission: (args) => inner.loadPipelineStageAdmission(args),
          reopenFailedPipeline: (args) => inner.reopenFailedPipeline(args),
          reopenInterruptedPipeline: (args) => inner.reopenInterruptedPipeline(args),
          reopenProvisionalSkippedStages: (args) => inner.reopenProvisionalSkippedStages(args),
          reopenFailedStagesForResume: (entryRunId) => inner.reopenFailedStagesForResume(entryRunId),
          restoreReopenedFailedStages: (reopened) => inner.restoreReopenedFailedStages(reopened),
          commitTerminalPublicationFailure: (args) => inner.commitTerminalPublicationFailure(args),
          commitTerminalPublicationSuccess: (args) => inner.commitTerminalPublicationSuccess(args),
          appendSupersedeFailures: (args) => inner.appendSupersedeFailures(args),
          dismissPipeline: (args) => inner.dismissPipeline(args),
          undismissPipeline: (args) => inner.undismissPipeline(args),
          recordAttemptStart: (runId) => inner.recordAttemptStart(runId),
          setRunStatus: (runId, status) => {
            if (status === "failed") failedStatusWrites += 1;
            inner.setRunStatus(runId, status);
          },
          admitRunForResume: (runId) => inner.admitRunForResume(runId),
          incrementSlotRedriveCount: (runId) => inner.incrementSlotRedriveCount(runId),
          commitGuardedKill: (runId) => inner.commitGuardedKill(runId),
          commitTerminalRunSettlement: (args) => inner.commitTerminalRunSettlement(args),
          dismissRun: (runId) => inner.dismissRun(runId),
          undismissRun: (runId) => inner.undismissRun(runId),
          dismissTerminalRunsForProject: (args) => inner.dismissTerminalRunsForProject(args),
          forceKillOwnerAdmits: (runId) => inner.forceKillOwnerAdmits(runId),
          beginRunReconciliation: () => inner.beginRunReconciliation(),
          finishRunReconciliation: (runId) => inner.finishRunReconciliation(runId),
          reconcilePipelines: () => inner.reconcilePipelines(),
          listRuns: () => inner.listRuns(),
          listIncidentCandidateRuns: (args) => inner.listIncidentCandidateRuns(args),
          listIncidentCandidatePipelines: (args) => inner.listIncidentCandidatePipelines(args),
          hasQueuedRun: (args) => inner.hasQueuedRun(args),
          listQueuedRuns: () => inner.listQueuedRuns(),
          hasNotificationDelivery: (args) => inner.hasNotificationDelivery(args),
          listNotificationDeliveriesForIncidentIds: (incidentIds) =>
            inner.listNotificationDeliveriesForIncidentIds(incidentIds),
          listDeliveredNotificationIncidents: (args) => inner.listDeliveredNotificationIncidents(args),
          loadDeliveredNotificationIncident: (args) => inner.loadDeliveredNotificationIncident(args),
          tryRecordNotificationDelivery: (args) => inner.tryRecordNotificationDelivery(args),
          releaseNotificationDelivery: (args) => inner.releaseNotificationDelivery(args),
          loadNotificationKeyFormatVersion: () => inner.loadNotificationKeyFormatVersion(),
          recordNotificationKeyFormatVersion: (version) => inner.recordNotificationKeyFormatVersion(version),
          isClosed: () => inner.isClosed(),
          close: () => inner.close(),
          commitCompletionBoundary: (args) => inner.commitCompletionBoundary(args),
        };
        const result = await runLoop({
          jarvisRoot,
          stateDbPath,
          store,
          maxIterations: 2,
          artifactPath: ".jarvis-plan-stage",
          specPath: PLAN_DRAFT_SPEC_PATH,
          promptId: "plan.prompt.draft",
          intentSeed: PLAN_DRAFT_INTENT_SEED,
          bindings: [
            {
              id: "draft",
              metadata: { agent: "test-agent", model: "test" },
              invoke: async ({ cwd }) => {
                const stage = join(cwd, ".jarvis-plan-stage");
                mkdirSync(stage, { recursive: true });
                writeFileSync(join(stage, "intent.md"), "---\nname: test\n---\n", "utf8");
                writeFileSync(join(stage, "index.md"), "# Index\n\n- [ ] [00 - One](./00-one.md)\n", "utf8");
                writeFileSync(
                  join(stage, "00-one.md"),
                  "# One\n\n## Acceptance criteria\n\n- [ ] single surface task\n",
                  "utf8",
                );
                return { kind: "ok", stdout: "done", stderr: "" };
              },
            },
          ],
        });
        expect(result.kind).toBe("landing_failed");
        expect(failedStatusWrites).toBe(0);
        const settled = loadRunOnce(stateDbPath, result.runId);
        expect(settled?.status).toBe("failed");
        expect(settled?.terminalCause).toBe("landing_failed");
        expect(settled?.finishedAt).not.toBeNull();
      } finally {
        mock.module("./staged-markdown-lint.ts", () => realLint);
      }
    });

    test("ready_gate_failed settlement exposes atomic cause and failure detail before loop_finished", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const gateError = new ReadyGateError("bun run ready", 1, "tests failed");
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        maxIterations: 1,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        ...completionHooks,
        readyFinalizer: async () => {
          throw gateError;
        },
      });
      expect(result.kind).toBe("ready_gate_failed");
      const settled = loadRunOnce(stateDbPath, result.runId);
      expect(settled?.status).toBe("failed");
      expect(settled?.terminalCause).toBe("ready_gate_failed");
      expect(settled?.terminalFailureDetail).toMatchObject({
        failureKind: "error",
        bindingAttempts: [],
        message: expect.stringContaining("tests failed"),
      });
      expect(settled?.operatorFailureRecord).toEqual({
        expectation: 'ready gate "bun run ready" exits 0 with no findings',
        observation: "ready gate exited 1; findings: tests failed",
        retryable: true,
        referencedPaths: [{ path: join(jarvisRoot, "worktrees", "demo", "write-run"), origin: "operator-repository" }],
      });
    });

    test("records successful observed runtime smoke separately from not-runnable evidence", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        logSink,
        ...completionHooks,
        readyFinalizer: async () => ({ runtimeSmokeOutcome: { kind: "observed-clean" } }),
      });

      expect(result.kind).toBe("complete");
      expect(logSink.getEventsForRun(result.runId)).toContainEqual({
        kind: "runtime_smoke_outcome",
        outcome: "observed-clean",
      });
    });

    test("records successful runtime smoke evidence when the ready flip fails", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      const outcome = { kind: "observed-clean" } as const;
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        logSink,
        ...completionHooks,
        readyFinalizer: async () => {
          throw new ReadyFlipError(new Error("gh pr ready failed"), outcome);
        },
      });

      expect(result.kind).toBe("ready_flip_failed");
      expect(logSink.getEventsForRun(result.runId)).toContainEqual({
        kind: "runtime_smoke_outcome",
        outcome: "observed-clean",
      });
    });

    test("rejects an empty discovery reason before it reaches the durable log", () => {
      const logSink = new TestLogSink();
      const invalidOutcome = {
        kind: "not-runnable",
        inspectedPaths: ["v2/src/execution/write-loop.ts"],
        discoveryReason: "",
      } as unknown as SmokePass;

      expect(() => appendRuntimeSmokeOutcome(logSink, "run-1", invalidOutcome)).toThrow(
        "Runtime smoke discovery reason must be non-empty",
      );
      expect(logSink.getEventsForRun("run-1")).toEqual([]);
    });

    test("does not record runtime smoke evidence when successful publication has no outcome", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        logSink,
        ...completionHooks,
        readyFinalizer: async () => ({}),
      });

      expect(result.kind).toBe("complete");
      expect(logSink.getEventsForRun(result.runId).filter((event) => event.kind === "runtime_smoke_outcome")).toEqual(
        [],
      );
    });

    test("completed-run resume replays publication after a prior publication failure", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const branchName = "resume-publication";
      const publish = { commitSha: "commit-1", filesChanged: 2 };
      let publishCalls = 0;

      const first = await runLoop({
        jarvisRoot,
        stateDbPath,
        branchName,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        completionCommitter: async () => publish,
        completionPublisher: async () => {
          publishCalls += 1;
          throw new Error("push failed");
        },
        readyFinalizer: async () => {
          throw new Error("should not finalize before publication succeeds");
        },
      });
      expect(first.kind).toBe("completion_commit_failed");
      expect(first.resumable).toBe(true);
      expect(publishCalls).toBe(1);

      mkdirSync(join(jarvisRoot, "worktrees", "demo", branchName, ".git"), { recursive: true });

      const retry = await runLoop({
        jarvisRoot,
        stateDbPath,
        branchName,
        bindings: [],
        completionCommitter: async () => publish,
        completionPublisher: async () => {
          publishCalls += 1;
          return {};
        },
        readyFinalizer: async () => {},
      });
      expect(retry.kind).toBe("complete");
      expect(retry.runId).toBe(first.runId);
      expect(publishCalls).toBe(2);
    });

    test("completion_commit_failed settles the row failed, resumable, and admissible to run resume", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      const first = await runLoop({
        jarvisRoot,
        stateDbPath,
        logSink,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        completionCommitter: async () => ({ commitSha: "commit-1", filesChanged: 2 }),
        completionPublisher: async () => {
          throw new Error("push failed");
        },
      });
      expect(first.kind).toBe("completion_commit_failed");
      expect(first.resumable).toBe(true);

      const store = openStateStore(stateDbPath);
      try {
        const run = store.loadRun(first.runId);
        expect(run).toMatchObject({ status: "failed", terminalCause: "completion_commit_failed" });
        if (run === null || run === undefined) return;
        const terminalRecord = logSink.tail(first.runId).at(-1) as PersistedRecord & { event: LoopFinishedEvent };
        expect(resolveCompletionCommitFailedResumeContext(run, store, terminalRecord).ok).toBe(true);
      } finally {
        store.close();
      }
    });

    test("an inconclusive mutation candidate is recorded on the run and publication proceeds", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      const inconclusive = {
        file: "v2/src/execution/slow.ts",
        line: 3,
        reason: "inconclusive: unmutated killing set (v2/src/execution/slow.test.ts) exceeded the 120000ms ceiling",
      };
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        promptId: "implement.prompt.body",
        logSink,
        bindings: [
          {
            id: "implement",
            metadata: { agent: "test-agent", model: "test" },
            invoke: async ({ cwd }) => {
              writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
              return { kind: "ok", stdout: "done", stderr: "" };
            },
          },
        ],
        verifyDiffDerivedMutations: async () => ({
          kind: "pass",
          runBase: "HEAD",
          inspectedPaths: [inconclusive.file],
          candidateCount: 1,
          acceptedSites: [],
          skippedCandidates: [inconclusive, { file: "v2/src/execution/other.ts", line: 9, reason: "stale candidate" }],
        }),
        completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 1 }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(result.kind).toBe("complete");
      const events = logSink.getEventsForRun(result.runId);
      expect(events.find((event) => event.kind === "mutation_verification_inconclusive")).toMatchObject({
        kind: "mutation_verification_inconclusive",
        candidates: [inconclusive],
      });
      expect(events.at(-1)).toMatchObject({ kind: "loop_finished", loopOutcomeKind: "complete" });
    });

    test("runsInLoopDiffDerivedMutationVerification gates implement and shrink prompts only", () => {
      const shrinkBinding = {
        role: "shrink",
        agents: ["claude"],
        agentModelConfig: stubAgentModelConfig(["claude"]),
      };
      expect(runsInLoopDiffDerivedMutationVerification({ promptId: "implement.prompt.body" })).toBe(true);
      expect(
        runsInLoopDiffDerivedMutationVerification({
          promptId: "implement.prompt.shrink",
          bindingResolution: shrinkBinding,
        }),
      ).toBe(true);
      expect(runsInLoopDiffDerivedMutationVerification({ promptId: "write.execute" })).toBe(false);
      expect(runsInLoopDiffDerivedMutationVerification({ bindingResolution: shrinkBinding })).toBe(true);
      expect(isShrinkWriteLoop({ promptId: "implement.prompt.body" })).toBe(false);
      expect(isShrinkWriteLoop({ promptId: "implement.prompt.shrink", bindingResolution: shrinkBinding })).toBe(true);
    });

    test("shrink complete surviving mutation reprompts before loop complete", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      let verifyCalls = 0;
      let invocations = 0;

      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        promptId: "implement.prompt.shrink",
        promptPlaceholders: SHRINK_LOOP_TEST_PLACEHOLDERS,
        maxIterations: 3,
        logSink,
        bindings: [
          {
            id: "shrink",
            metadata: { agent: "test-agent", model: "test" },
            invoke: async ({ cwd }) => {
              invocations += 1;
              writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
              return { kind: "ok", stdout: "done", stderr: "" };
            },
          },
        ],
        verifyDiffDerivedMutations: async () => {
          verifyCalls += 1;
          if (verifyCalls === 1) {
            return {
              kind: "surviving-mutation",
              mutation: IN_LOOP_SURVIVING_MUTATION,
              killingTests: ["v2/src/guard.test.ts"],
              killingSetObservedResult: "passed-confirmed",
              sourceSite: { file: IN_LOOP_SURVIVING_SOURCE_FILE, line: IN_LOOP_SURVIVING_SOURCE_LINE },
              dualConstraint: true,
            };
          }
          return {
            kind: "pass",
            runBase: "HEAD",
            inspectedPaths: [],
            candidateCount: 0,
            acceptedSites: [],
            skippedCandidates: [],
          };
        },
        completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 1 }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(invocations).toBe(2);
      expect(verifyCalls).toBe(2);
      expect(result.kind).toBe("complete");
      const events = logSink.getEventsForRun(result.runId).map((event) => event.kind);
      expect(events).toContain("surviving_mutation_reprompt");
      expect(events).not.toContain("surviving_mutation_failed");
      const completeIndex = events.lastIndexOf("loop_finished");
      expect(completeIndex).toBeGreaterThan(events.indexOf("surviving_mutation_reprompt"));
      expect(logSink.getEventsForRun(result.runId).at(-1)).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "complete",
      });
    });

    test("resolvePreShrinkHead prefers the logged pre-shrink head over a caller-supplied head", () => {
      const logged = [{ event: { kind: "pre_shrink_head", head: "logged-sha" } }] as unknown as Parameters<
        typeof resolvePreShrinkHead
      >[1];
      expect(resolvePreShrinkHead("fresh-post-shrink-sha", logged)).toBe("logged-sha");
      expect(resolvePreShrinkHead("fresh-sha", [])).toBe("fresh-sha");
      expect(resolvePreShrinkHead("fresh-sha", undefined)).toBe("fresh-sha");
      expect(resolvePreShrinkHead(undefined, logged)).toBe("logged-sha");
    });

    test("shrink surviving mutation reprompt budget exhaustion reverts to pre-shrink HEAD and completes", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const branchName = "shrink-mutation-revert";
      const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
      mkdirSync(worktreePath, { recursive: true });
      execFileSync("git", ["init", worktreePath], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "config", "user.email", "test@example.com"], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "config", "user.name", "Test User"], { stdio: "pipe" });
      writeFileSync(join(worktreePath, ".gitignore"), ".scratch/\n", "utf8");
      writeFileSync(join(worktreePath, "spec.md"), "- [ ] work\n", "utf8");
      writeFileSync(join(worktreePath, "proof.txt"), "verified\n", "utf8");
      execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "commit", "-m", "verified"], { stdio: "pipe" });
      const preShrinkHead = execFileSync("git", ["-C", worktreePath, "rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim();
      const logSink = new TestLogSink();
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        branchName,
        promptId: "implement.prompt.shrink",
        preShrinkHead,
        promptPlaceholders: SHRINK_LOOP_TEST_PLACEHOLDERS,
        maxIterations: 2,
        logSink,
        bindings: [
          {
            id: "shrink",
            metadata: { agent: "test-agent", model: "test" },
            invoke: async ({ cwd }) => {
              writeFileSync(join(cwd, "proof.txt"), "shrunk\n", "utf8");
              mkdirSync(join(cwd, ".scratch"), { recursive: true });
              writeFileSync(join(cwd, ".scratch", "shrink-narrative.md"), "reverted simplification\n", "utf8");
              return { kind: "ok", stdout: "done", stderr: "" };
            },
          },
        ],
        verifyDiffDerivedMutations: async () => ({
          kind: "surviving-mutation",
          mutation: IN_LOOP_SURVIVING_MUTATION,
          killingTests: [],
          killingSetObservedResult: "not-run",
          sourceSite: { file: IN_LOOP_SURVIVING_SOURCE_FILE, line: IN_LOOP_SURVIVING_SOURCE_LINE },
          dualConstraint: true,
        }),
        completionCommitter: createCompletionCommitter(),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(
        Number(
          execFileSync("git", ["-C", worktreePath, "rev-list", "--count", `${preShrinkHead}..HEAD`], {
            encoding: "utf8",
          }).trim(),
        ),
      ).toBe(0);
      expect(execFileSync("git", ["-C", worktreePath, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toBe(
        preShrinkHead,
      );
      expect(execFileSync("git", ["-C", worktreePath, "status", "--porcelain"], { encoding: "utf8" })).toBe("");
      expect(existsSync(join(worktreePath, ".scratch", "shrink-narrative.md"))).toBe(false);
      expect(result.kind).toBe("complete");
      const events = logSink.getEventsForRun(result.runId).map((event) => event.kind);
      expect(events).toContain("surviving_mutation_reprompt");
      expect(events).not.toContain("surviving_mutation_failed");
      expect(logSink.getEventsForRun(result.runId).at(-1)).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "complete",
      });
    });

    test("shrink complete non-terminating mutation reverts to pre-shrink HEAD and completes", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const branchName = "shrink-non-terminating-revert";
      const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
      mkdirSync(worktreePath, { recursive: true });
      execFileSync("git", ["init", worktreePath], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "config", "user.email", "test@example.com"], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "config", "user.name", "Test User"], { stdio: "pipe" });
      writeFileSync(join(worktreePath, ".gitignore"), "\n", "utf8");
      writeFileSync(join(worktreePath, "spec.md"), "- [ ] work\n", "utf8");
      writeFileSync(join(worktreePath, "proof.txt"), "verified\n", "utf8");
      execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "commit", "-m", "verified"], { stdio: "pipe" });
      const preShrinkHead = execFileSync("git", ["-C", worktreePath, "rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim();
      const logSink = new TestLogSink();
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        branchName,
        promptId: "implement.prompt.shrink",
        preShrinkHead,
        promptPlaceholders: SHRINK_LOOP_TEST_PLACEHOLDERS,
        maxIterations: 1,
        logSink,
        bindings: [
          {
            id: "shrink",
            metadata: { agent: "test-agent", model: "test" },
            invoke: async ({ cwd }) => {
              writeFileSync(join(cwd, "proof.txt"), "shrunk\n", "utf8");
              return { kind: "ok", stdout: "done", stderr: "" };
            },
          },
        ],
        verifyDiffDerivedMutations: async () => ({
          kind: "non-terminating-mutation",
          mutation: "hang-mutant",
          sourceSite: { file: IN_LOOP_SURVIVING_SOURCE_FILE, line: IN_LOOP_SURVIVING_SOURCE_LINE },
        }),
        completionCommitter: createCompletionCommitter(),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(execFileSync("git", ["-C", worktreePath, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toBe(
        preShrinkHead,
      );
      expect(result.kind).toBe("complete");
      const events = logSink.getEventsForRun(result.runId).map((event) => event.kind);
      expect(events).not.toContain("non_terminating_mutation_failed");
      expect(logSink.getEventsForRun(result.runId).at(-1)).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "complete",
      });
    });

    test("implement complete surviving mutation reprompts before publication", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      let verifyCalls = 0;
      let invocations = 0;
      let repromptPrompt = "";

      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        promptId: "implement.prompt.body",
        maxIterations: 3,
        logSink,
        bindings: [
          {
            id: "implement",
            metadata: { agent: "test-agent", model: "test" },
            invoke: async ({ cwd, prompt }) => {
              invocations += 1;
              repromptPrompt = prompt;
              writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
              return { kind: "ok", stdout: "done", stderr: "" };
            },
          },
        ],
        verifyDiffDerivedMutations: async () => {
          verifyCalls += 1;
          if (verifyCalls === 1) {
            return {
              kind: "surviving-mutation",
              mutation: IN_LOOP_SURVIVING_MUTATION,
              killingTests: ["v2/src/guard.test.ts"],
              killingSetObservedResult: "passed-confirmed",
              sourceSite: { file: IN_LOOP_SURVIVING_SOURCE_FILE, line: IN_LOOP_SURVIVING_SOURCE_LINE },
              dualConstraint: true,
            };
          }
          return {
            kind: "pass",
            runBase: "HEAD",
            inspectedPaths: [],
            candidateCount: 0,
            acceptedSites: [],
            skippedCandidates: [],
          };
        },
        completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 1 }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(invocations).toBe(2);
      expect(verifyCalls).toBe(2);
      expect(result.kind).toBe("complete");
      expect(result.iterationsConsumed).toBe(2);
      expect(repromptPrompt).toContain(IN_LOOP_SURVIVING_MUTATION);
      expect(repromptPrompt).toContain(IN_LOOP_SURVIVING_SOURCE_FILE);
      expect(repromptPrompt).toContain(String(IN_LOOP_SURVIVING_SOURCE_LINE));
      expect(repromptPrompt).toContain("@mutate-equivalent");
      const events = logSink.getEventsForRun(result.runId).map((event) => event.kind);
      expect(events).toContain("surviving_mutation_reprompt");
      expect(events).not.toContain("surviving_mutation_failed");
      const reprompt = logSink
        .getEventsForRun(result.runId)
        .find((event) => event.kind === "surviving_mutation_reprompt");
      expect(reprompt).toMatchObject({
        kind: "surviving_mutation_reprompt",
        mutation: IN_LOOP_SURVIVING_MUTATION,
        sourceFile: IN_LOOP_SURVIVING_SOURCE_FILE,
        sourceLine: IN_LOOP_SURVIVING_SOURCE_LINE,
        dualConstraint: true,
      });
      expect(logSink.getEventsForRun(result.runId).at(-1)).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "complete",
      });
    });

    test("implement complete honors exact mutate-equivalent directive in-loop", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      const guardMutation = "guard-flip: !x → x";
      const guardDirective = `// @mutate-equivalent mutation="${guardMutation}" reason="Caller contract guarantees truthy x"`;
      const sourceFile = "v2/src/guard.ts";
      const sourceLine = `  if (!x) return "safe"; ${guardDirective}`;
      const originalContent = `export function guard(x: unknown) {\n${sourceLine}\n  return x;\n}\n`;
      const diff = `diff --git a/${sourceFile} b/${sourceFile}
index 1234567..abcdefg 100644
--- a/${sourceFile}
+++ b/${sourceFile}
@@ -1,3 +1,3 @@
 export function guard(x: unknown) {
-  if (!x) return null;
+${sourceLine}
   return x;
`;
      let verifyCalls = 0;

      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        promptId: "implement.prompt.body",
        logSink,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        verifyDiffDerivedMutations: async (input) => {
          verifyCalls += 1;
          return verifyDiffDerivedMutations(input, {
            gitDiff: async () => diff,
            untrackedFiles: async () => [],
            readFile: async () => originalContent,
            writeFile: async () => {},
            listDir: () => [],
            runScopedTests: async () => true,
          });
        },
        completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 1 }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(verifyCalls).toBe(1);
      expect(result.kind).toBe("complete");
      const events = logSink.getEventsForRun(result.runId).map((event) => event.kind);
      expect(events).not.toContain("surviving_mutation_reprompt");
      expect(events).not.toContain("surviving_mutation_failed");
      expect(logSink.getEventsForRun(result.runId).at(-1)).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "complete",
      });
    });

    test("implement complete surviving mutation reprompt budget exhaustion settles surviving_mutation_failed", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      let invocations = 0;

      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        promptId: "implement.prompt.body",
        maxIterations: 2,
        logSink,
        bindings: [
          {
            id: "implement",
            metadata: { agent: "test-agent", model: "test" },
            invoke: async ({ cwd }) => {
              invocations += 1;
              writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
              return { kind: "ok", stdout: "done", stderr: "" };
            },
          },
        ],
        verifyDiffDerivedMutations: async () => ({
          kind: "surviving-mutation",
          mutation: IN_LOOP_SURVIVING_MUTATION,
          killingTests: ["v2/src/guard.test.ts"],
          killingSetObservedResult: "passed-confirmed",
          sourceSite: { file: IN_LOOP_SURVIVING_SOURCE_FILE, line: IN_LOOP_SURVIVING_SOURCE_LINE },
        }),
        completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 1 }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {
          throw new Error("publication mutation verification should not run");
        },
      });

      expect(invocations).toBe(2);
      expect(result.kind).toBe("surviving_mutation_failed");
      expect(result.resumable).toBe(true);
      expect(result.survivingMutation).toBe(IN_LOOP_SURVIVING_MUTATION);
      expect(result.survivingMutationSourceFile).toBe(IN_LOOP_SURVIVING_SOURCE_FILE);
      expect(result.survivingMutationSourceLine).toBe(IN_LOOP_SURVIVING_SOURCE_LINE);
      expect(result.survivingMutationKillingTests).toEqual(["v2/src/guard.test.ts"]);
      expect(result.survivingMutationKillingSetResult).toBe("passed-confirmed");
      expect(loadRunOnce(stateDbPath, result.runId)?.status).toBe("failed");
      const events = logSink.getEventsForRun(result.runId).map((event) => event.kind);
      expect(events).toContain("surviving_mutation_reprompt");
      expect(events).not.toContain("blocked");
      expect(events).not.toContain("contract_miss");
      expect(events).not.toContain("mutation_repair_exhausted");
      const loopEvent = logSink.getEventsForRun(result.runId).at(-1);
      expect(loopEvent).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "surviving_mutation_failed",
        resumable: true,
        survivingMutation: IN_LOOP_SURVIVING_MUTATION,
        survivingMutationSourceFile: IN_LOOP_SURVIVING_SOURCE_FILE,
        survivingMutationSourceLine: IN_LOOP_SURVIVING_SOURCE_LINE,
        survivingMutationKillingTests: ["v2/src/guard.test.ts"],
        survivingMutationKillingSetResult: "passed-confirmed",
      });
      const run = openStateStore(stateDbPath).loadRun(result.runId);
      expect(run).toBeDefined();
      if (!run) return;
      expect(
        composeRunOperatorError(run, {
          runId: result.runId,
          seq: 1,
          ts: "",
          event: loopEvent as LoopFinishedEvent,
        }),
      ).toMatchObject({
        reason: "surviving_mutation_failed",
        nextAction: "resume",
        retryable: true,
      });
    });

    test("implement complete non-terminating mutation settles non_terminating_mutation_failed without reprompt or re-entry", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      let verifyCalls = 0;
      let invocations = 0;

      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        promptId: "implement.prompt.body",
        maxIterations: 3,
        logSink,
        bindings: [
          {
            id: "implement",
            metadata: { agent: "test-agent", model: "test" },
            invoke: async ({ cwd }) => {
              invocations += 1;
              writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
              return { kind: "ok", stdout: "done", stderr: "" };
            },
          },
        ],
        verifyDiffDerivedMutations: async () => {
          verifyCalls += 1;
          return {
            kind: "non-terminating-mutation",
            mutation: IN_LOOP_NON_TERMINATING_MUTATION,
            sourceSite: { file: IN_LOOP_NON_TERMINATING_SOURCE_FILE, line: IN_LOOP_NON_TERMINATING_SOURCE_LINE },
          };
        },
        completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 1 }),
        completionPublisher: async () => {
          throw new Error("publication should not run");
        },
        readyFinalizer: async () => {
          throw new Error("ready finalization should not run");
        },
      });

      expect(invocations).toBe(1);
      expect(verifyCalls).toBe(1);
      expect(result.kind).toBe("non_terminating_mutation_failed");
      expect(result.resumable).toBe(true);
      expect(result.nonTerminatingMutation).toBe(IN_LOOP_NON_TERMINATING_MUTATION);
      expect(result.nonTerminatingMutationSourceFile).toBe(IN_LOOP_NON_TERMINATING_SOURCE_FILE);
      expect(result.nonTerminatingMutationSourceLine).toBe(IN_LOOP_NON_TERMINATING_SOURCE_LINE);
      expect(loadRunOnce(stateDbPath, result.runId)?.status).toBe("failed");
      const events = logSink.getEventsForRun(result.runId).map((event) => event.kind);
      expect(events).not.toContain("surviving_mutation_reprompt");
      expect(events).not.toContain("surviving_mutation_failed");
      const loopEvent = logSink.getEventsForRun(result.runId).at(-1);
      expect(loopEvent).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "non_terminating_mutation_failed",
        resumable: true,
        nonTerminatingMutation: IN_LOOP_NON_TERMINATING_MUTATION,
        nonTerminatingMutationSourceFile: IN_LOOP_NON_TERMINATING_SOURCE_FILE,
        nonTerminatingMutationSourceLine: IN_LOOP_NON_TERMINATING_SOURCE_LINE,
      });
      const run = openStateStore(stateDbPath).loadRun(result.runId);
      expect(run).toBeDefined();
      if (!run) return;
      expect(
        composeRunOperatorError(run, {
          runId: result.runId,
          seq: 1,
          ts: "",
          event: loopEvent as LoopFinishedEvent,
        }),
      ).toMatchObject({
        reason: "non_terminating_mutation_failed",
        nextAction: "resume",
        retryable: true,
      });
    });

    test("returns non_terminating_mutation_failed when publication mutation verification times out", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      let readyFinalizerCalls = 0;
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 1 }),
        completionPublisher: async () => ({ prNumber: 42, prUrl: "https://example.com/pr/42" }),
        readyFinalizer: async () => {
          readyFinalizerCalls += 1;
          throw new NonTerminatingMutationError(
            IN_LOOP_NON_TERMINATING_MUTATION,
            IN_LOOP_NON_TERMINATING_SOURCE_FILE,
            IN_LOOP_NON_TERMINATING_SOURCE_LINE,
          );
        },
      });

      expect(readyFinalizerCalls).toBe(1);
      expect(result.kind).toBe("non_terminating_mutation_failed");
      expect(result.resumable).toBe(true);
      expect(result.prNumber).toBe(42);
      expect(result.nonTerminatingMutation).toBe(IN_LOOP_NON_TERMINATING_MUTATION);
      expect(result.nonTerminatingMutationSourceFile).toBe(IN_LOOP_NON_TERMINATING_SOURCE_FILE);
      expect(result.nonTerminatingMutationSourceLine).toBe(IN_LOOP_NON_TERMINATING_SOURCE_LINE);
      expect(loadRunOnce(stateDbPath, result.runId)?.status).toBe("failed");
      expect(logSink.getEventsForRun(result.runId).at(-1)).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "non_terminating_mutation_failed",
        resumable: true,
        prNumber: 42,
        nonTerminatingMutation: IN_LOOP_NON_TERMINATING_MUTATION,
        nonTerminatingMutationSourceFile: IN_LOOP_NON_TERMINATING_SOURCE_FILE,
        nonTerminatingMutationSourceLine: IN_LOOP_NON_TERMINATING_SOURCE_LINE,
      });
    });

    test("returns surviving_mutation_failed when mutation verification detects an uncovered changed guard", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      const sessionsDir = join(jarvisRoot, "sessions");
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 1 }),
        completionPublisher: async () => ({}),
        verifyDiffDerivedMutations: mockVerifyPass,
        readyFinalizer: async () => {
          throw publicationSurvivor();
        },
      });

      expect(result.kind).toBe("surviving_mutation_failed");
      expect(result.resumable).toBe(true);
      expect(result.survivingMutation).toBe("operator-flip: === → !==");
      expect(result.survivingMutationSourceFile).toBe("src/test.ts");
      expect(result.survivingMutationSourceLine).toBe(42);
      expect(result.survivingMutationKillingTests).toEqual(["src/test.test.ts"]);
      expect(result.survivingMutationKillingSetResult).toBe("passed-unconfirmed");
      expect(loadRunOnce(stateDbPath, result.runId)?.status).toBe("failed");
      // Publication runs in-flow `write.mutation-repair` (session evidence) before terminal settlement.
      const events = logSink.getEventsForRun(result.runId);
      const repairAttempts = mutationRepairSessionAttempts(sessionsDir, result.runId);
      expect(repairAttempts.length).toBeGreaterThan(0);
      expect(iterationStartsBeforeLoopFinished(events)).toBe(1 + repairAttempts.length);
      expect(loopOutcomeKinds(events)).toEqual(["surviving_mutation_failed"]);
      expect(events.at(-1)).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "surviving_mutation_failed",
        resumable: true,
        survivingMutation: "operator-flip: === → !==",
        survivingMutationSourceFile: "src/test.ts",
        survivingMutationSourceLine: 42,
        survivingMutationKillingTests: ["src/test.test.ts"],
        survivingMutationKillingSetResult: "passed-unconfirmed",
      });
    });

    test("publication surviving mutation exhausts in-flow write.mutation-repair before resumable settlement", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      const sessionsDir = join(jarvisRoot, "sessions");
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 1 }),
        completionPublisher: async () => ({}),
        verifyDiffDerivedMutations: mockVerifyPass,
        readyFinalizer: async () => {
          throw publicationSurvivor();
        },
      });

      expect(result.kind).toBe("surviving_mutation_failed");
      expect(result.resumable).toBe(true);
      const events = logSink.getEventsForRun(result.runId);
      expect(mutationRepairSessionAttempts(sessionsDir, result.runId)).toEqual([1, 2, 3]);
      expect(MAX_MUTATION_REPAIR_ATTEMPTS).toBe(3);
      expect(iterationStartsBeforeLoopFinished(events)).toBe(1 + MAX_MUTATION_REPAIR_ATTEMPTS);
      expect(loopOutcomeKinds(events)).toEqual(["surviving_mutation_failed"]);
      expect(events.at(-1)).toMatchObject({ kind: "loop_finished", resumable: true });
      const store = openStateStore(stateDbPath);
      try {
        expect(store.readMutationRepairAttempts(result.runId)).toBe(MAX_MUTATION_REPAIR_ATTEMPTS);
      } finally {
        store.close();
      }
    });

    test("publication in-flow mutation repair blocked settles surviving_mutation_failed without mutation_repair_exhausted", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      const sessionsDir = join(jarvisRoot, "sessions");
      let agentCalls = 0;
      const bindings: InvocationBinding[] = [
        {
          id: "implement-then-repair",
          metadata: { agent: "codex", model: "test" },
          invoke: async ({ cwd }) => {
            agentCalls += 1;
            if (agentCalls === 1) {
              writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
              return { kind: "ok", stdout: "done", stderr: "" };
            }
            return { kind: "ok", stdout: "blocked", stderr: "" };
          },
        },
      ];
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings,
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 1 }),
        completionPublisher: async () => ({}),
        verifyDiffDerivedMutations: mockVerifyPass,
        readyFinalizer: async () => {
          throw publicationSurvivor();
        },
      });

      expect(result.kind).toBe("surviving_mutation_failed");
      expect(result.resumable).toBe(true);
      expect(agentCalls).toBe(2);
      expect(mutationRepairSessionAttempts(sessionsDir, result.runId)).toEqual([1]);
      const events = logSink.getEventsForRun(result.runId);
      expect(loopOutcomeKinds(events)).toEqual(["surviving_mutation_failed"]);
      expect(events.at(-1)).toMatchObject({ kind: "loop_finished", resumable: true });
    });

    test("publication mutation repair continues the persisted shared attempt budget", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const store = openStateStore(stateDbPath);
      const branchName = "shared-mutation-repair-budget";
      const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
      mkdirSync(worktreePath, { recursive: true });
      const runId = store.createRun({
        project: "demo",
        specRef: "HEAD",
        worktreePath,
        branch: branchName,
        specPath: "spec.md",
      });
      store.recordMutationRepairAttempts(runId, 2);
      const sessionsDir = join(jarvisRoot, "sessions");
      try {
        const published = await publishSurvivingMutation({
          jarvisRoot,
          store,
          runId,
          branchName,
          worktreePath,
          bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        });
        expect(published.failure?.kind).toBe("surviving_mutation_failed");
        expect(store.readMutationRepairAttempts(runId)).toBe(MAX_MUTATION_REPAIR_ATTEMPTS);
        expect(mutationRepairSessionAttempts(sessionsDir, runId)).toEqual([3]);
      } finally {
        store.close();
      }
    });

    test("publication mutation repair skips a HEAD that drifted from the published tip without charging budget", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const store = openStateStore(stateDbPath);
      const branchName = "mutation-repair-head-drift";
      const { worktreePath, head: publishedTip } = initMutationRepairGitWorktree(jarvisRoot, branchName);
      writeFileSync(join(worktreePath, "local.txt"), "ahead\n", "utf8");
      gitIn(worktreePath, ["add", "local.txt"]);
      gitIn(worktreePath, ["commit", "-qm", "local commit ahead of the published tip"]);
      const runId = store.createRun({
        project: "demo",
        specRef: "HEAD",
        worktreePath,
        branch: branchName,
        specPath: "spec.md",
      });
      const logSink = new TestLogSink();
      let repairCalls = 0;
      try {
        const published = await publishSurvivingMutation({
          jarvisRoot,
          store,
          runId,
          branchName,
          worktreePath,
          logSink,
          publisherPushSha: () => publishedTip,
          bindings: [
            {
              id: "drift-repair",
              metadata: { agent: "codex", model: "test" },
              invoke: async () => {
                repairCalls += 1;
                return { kind: "ok", stdout: "done", stderr: "" };
              },
            },
          ],
        });
        expect(published.failure?.kind).toBe("surviving_mutation_failed");
        expect(repairCalls).toBe(0);
        expect(logSink.getEventsForRun(runId).filter((event) => event.kind === "iteration_started")).toHaveLength(0);
        expect(mutationRepairSessionAttempts(join(jarvisRoot, "sessions"), runId)).toEqual([]);
        // A later `jarvis run resume` keeps the full budget.
        expect(store.readMutationRepairAttempts(runId)).toBe(0);
      } finally {
        store.close();
      }
    });

    test("publication mutation repair reverts uncommitted edits when the repair iteration does not settle", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const store = openStateStore(stateDbPath);
      const branchName = "mutation-repair-unsettled-revert";
      const { worktreePath } = initMutationRepairGitWorktree(jarvisRoot, branchName);
      const sidecar = join(worktreePath, ".jarvis-review-feedback-response.md");
      writeFileSync(sidecar, "response\n", "utf8");
      const runId = store.createRun({
        project: "demo",
        specRef: "HEAD",
        worktreePath,
        branch: branchName,
        specPath: "spec.md",
      });
      try {
        const published = await publishSurvivingMutation({
          jarvisRoot,
          store,
          runId,
          branchName,
          worktreePath,
          iterationTimeoutMs: 1,
          bindings: [
            {
              id: "unsettled-repair",
              metadata: { agent: "codex", model: "test" },
              invoke: async ({ cwd, signal }) => {
                writeFileSync(join(cwd, "src", "guard.ts"), "export const guard = () => false;\n", "utf8");
                writeFileSync(join(cwd, "src", "partial-repair.test.ts"), "// half-written\n", "utf8");
                if (signal !== undefined && !signal.aborted) {
                  await new Promise<void>((resolve) =>
                    signal.addEventListener("abort", () => resolve(), { once: true }),
                  );
                }
                return { kind: "ok", stdout: "done", stderr: "" };
              },
            },
          ],
        });
        expect(published.failure?.kind).toBe("surviving_mutation_failed");
        expect(store.readMutationRepairAttempts(runId)).toBe(1);
        expect(existsSync(sidecar)).toBe(true);
        expect(gitIn(worktreePath, ["status", "--porcelain"]).trim()).toBe("?? .jarvis-review-feedback-response.md");
      } finally {
        store.close();
      }
    });

    test("isKillingTestWeakened flags deleted, de-asserted, or disabled killing tests", () => {
      const before = 'test("kills", () => {\n  expect(guard()).toBe(true);\n});\n';
      expect(isKillingTestWeakened(before, before)).toBe(false);
      expect(isKillingTestWeakened(before, `${before}test("more", () => {\n  expect(1).toBe(1);\n});\n`)).toBe(false);
      expect(isKillingTestWeakened(before, undefined)).toBe(true);
      expect(isKillingTestWeakened(before, 'test("kills", () => {\n  guard();\n});\n')).toBe(true);
      expect(isKillingTestWeakened(before, 'test.skip("kills", () => {\n  expect(guard()).toBe(true);\n});\n')).toBe(
        true,
      );
      expect(isKillingTestWeakened(before, "expect(guard()).toBe(true);\n")).toBe(true);
    });

    test("returns runtime_smoke_failed when runtime smoke verification fails", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 1 }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {
          throw new RuntimeSmokeFailedError("bun run v2/src/cli.ts --help", "error: command failed");
        },
      });

      expect(result.kind).toBe("runtime_smoke_failed");
      expect(result.resumable).toBe(false);
      expect(result.runtimeSmokeCommand).toBe("bun run v2/src/cli.ts --help");
      expect(result.runtimeSmokeObservation).toBe("error: command failed");
      expect(loadRunOnce(stateDbPath, result.runId)?.operatorFailureRecord).toBeNull();
      expect(logSink.getEventsForRun(result.runId).at(-1)).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "runtime_smoke_failed",
        resumable: false,
      });
    });

    test("every finalization exit restores a terminal durable status, never leaving the tail marker", async () => {
      // Publication marks the row `in-progress` for the finalization tail. A row left there is
      // non-live forever and hangs `run wait`, which follows the log for non-terminal rows.
      const cases = [
        {
          kind: "ready_flip_failed",
          status: "failed",
          finalizer: async () => {
            throw new Error("gh pr ready failed");
          },
        },
        {
          kind: "runtime_smoke_failed",
          status: "completed",
          finalizer: async () => {
            throw new RuntimeSmokeFailedError("bun run v2/src/cli.ts --help", "error: command failed");
          },
        },
      ] as const;

      for (const { kind, status, finalizer } of cases) {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const result = await runLoop({
          jarvisRoot,
          stateDbPath,
          bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
          completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 1 }),
          completionPublisher: async () => ({ prNumber: 7 }),
          readyFinalizer: finalizer,
        });

        expect(result.kind).toBe(kind);
        expect(loadRunOnce(stateDbPath, result.runId)?.status).toBe(status);
      }
    });
  });
});
