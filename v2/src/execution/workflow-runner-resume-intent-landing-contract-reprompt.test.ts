import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { trackedMkdtempSync } from "../../../shared/tracked-temp-dir.test-support.ts";
import type { LogEvent } from "../persistence/log-stream.ts";
import type { StateStore } from "../persistence/state-store.ts";
import { mockWriteLoopInput } from "../testing/run-control.ts";
import { withStateStore } from "../testing/write-fixtures.ts";
import { landReviewedOutputOrFail } from "./workflow-runner-debate-landing.ts";
import { DEFAULT_STAGED_MARKDOWN_LINT_RUNNER } from "./workflow-runner-resume.test-support.ts";
import { resolveIntentFinalizationResumeContext, resumePopulatedIntentPublication } from "./workflow-runner-resume.ts";
import type { WriteLoopInput } from "./write-loop.ts";

const PROSE_PREREQUISITES_INTENT = [
  "---",
  "name: bad-intent",
  "---",
  "",
  "# Bad Intent",
  "",
  "## Prerequisites",
  "",
  "This is prose, not a bullet list.",
  "",
].join("\n");

const FIXED_PREREQUISITES_INTENT = [
  "---",
  "name: bad-intent",
  "---",
  "",
  "# Bad Intent",
  "",
  "## Prerequisites",
  "",
  "- prior behavior exists",
  "",
].join("\n");

function seedReviewRow(
  store: StateStore,
  workspace: string,
  branch: string,
  invocationId: string,
  intentQueuedInput?: WriteLoopInput,
): string {
  const base = {
    project: "demo",
    specRef: "main",
    worktreePath: workspace,
    branch,
    workflowSnapshot: {
      invocationId,
      creationTitle: `intent: ${branch}`,
      steps: [
        {
          stepId: "intent",
          role: "plan",
          durable: true,
          expectedArtifactPath: ".jarvis-intent-stage",
          agents: ["claude"],
          landingInputs: { sourceRoot: workspace, paths: [], consumeFrom: "worktree" as const },
        },
        { stepId: "review", role: "", durable: true, behavior: "review" as const },
      ],
    },
  };
  store.createRun({
    ...base,
    specPath: "ready-intents",
    stepId: "intent",
    ...(intentQueuedInput !== undefined ? { queuedInput: intentQueuedInput } : {}),
  });
  const reviewRunId = store.createRun({ ...base, specPath: ".jarvis-intent-stage", stepId: "review" });
  store.setRunStatus(reviewRunId, "failed");
  const attemptId = store.recordAttemptStart(reviewRunId);
  store.commitCompletionBoundary({
    attemptId,
    runStatus: "failed",
    outcomeKind: "invocation_failure",
    invocationFailureDetail: { failureKind: "landing", bindingAttempts: [], message: "landing failed" },
  });
  return reviewRunId;
}

describe("intent finalization resume landing-contract reprompt", () => {
  test("prose Prerequisites refusal reprompts the agent via write.landing-contract-reprompt instead of settling landing_failed on first failure", async () => {
    const workspace = trackedMkdtempSync(join(tmpdir(), "intent-resume-landing-reprompt-"));
    mkdirSync(join(workspace, ".jarvis-intent-stage"), { recursive: true });
    writeFileSync(join(workspace, ".jarvis-intent-stage", "bad-intent.md"), PROSE_PREREQUISITES_INTENT, "utf8");
    mkdirSync(join(workspace, "ready-intents"), { recursive: true });

    await withStateStore(async (store) => {
      const branch = "intent/landing-reprompt";
      const queuedInput: WriteLoopInput = {
        ...mockWriteLoopInput({ projectRoot: workspace, projectName: "demo", branchName: branch, baseRef: "none" }),
        maxIterations: 2,
        bindingResolution: {
          role: "plan",
          agents: ["claude"],
          agentModelConfig: { claude: { plan: { rungs: [{ adapterModel: "claude-model", priceKey: "claude" }] } } },
        },
      };
      const reviewRunId = seedReviewRow(store, workspace, branch, "intent-landing-reprompt", queuedInput);
      const run = store.loadRun(reviewRunId);
      if (!run) throw new Error("expected review run");
      expect(resolveIntentFinalizationResumeContext(run, store)).toMatchObject({ ok: true });

      let invocations = 0;
      let repromptPrompt = "";
      const outcome = await resumePopulatedIntentPublication(run, store, {
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
        createBinding: () => ({
          id: "claude/claude-model",
          invoke: async ({ prompt }) => {
            invocations += 1;
            repromptPrompt = prompt;
            writeFileSync(join(workspace, ".jarvis-intent-stage", "bad-intent.md"), FIXED_PREREQUISITES_INTENT, "utf8");
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        }),
      });

      expect(outcome).toMatchObject({ ok: true });
      expect(invocations).toBe(1);
      expect(repromptPrompt).toContain("must list prerequisites as one bullet per line");
      expect(repromptPrompt).toContain("bad-intent.md");
      expect(existsSync(join(workspace, "ready-intents", "bad-intent.md"))).toBe(true);
      expect(store.loadRun(reviewRunId)?.status).toBe("completed");
    });
  });

  test("forwards the injected lint runner to the landing gate instead of falling back to the default spawn", async () => {
    const workspace = trackedMkdtempSync(join(tmpdir(), "intent-resume-landing-runner-"));
    mkdirSync(join(workspace, ".jarvis-intent-stage"), { recursive: true });
    writeFileSync(join(workspace, ".jarvis-intent-stage", "bad-intent.md"), PROSE_PREREQUISITES_INTENT, "utf8");
    mkdirSync(join(workspace, "ready-intents"), { recursive: true });

    await withStateStore(async (store) => {
      const branch = "intent/landing-runner-injection";
      const queuedInput: WriteLoopInput = {
        ...mockWriteLoopInput({ projectRoot: workspace, projectName: "demo", branchName: branch, baseRef: "none" }),
        maxIterations: 2,
        bindingResolution: {
          role: "plan",
          agents: ["claude"],
          agentModelConfig: { claude: { plan: { rungs: [{ adapterModel: "claude-model", priceKey: "claude" }] } } },
        },
      };
      const reviewRunId = seedReviewRow(store, workspace, branch, "intent-landing-runner-injection", queuedInput);
      const run = store.loadRun(reviewRunId);
      if (!run) throw new Error("expected review run");

      // The initial reviewed-staged-markdown lint check (staged-markdown-lint.ts) passes `--no-globs`;
      // only the landing gate's autofix (repairIntentStageContent, reached through the guard under
      // test) runs without it. Counting only those invocations isolates forwarding for that guard
      // from the unrelated, always-forwarded initial check.
      let autofixRunnerCalls = 0;
      const spyRunner: AsyncSubprocessRunner = {
        runAsync: async (cmd, args, cwd, options) => {
          if (args.includes("--fix") && !args.includes("--no-globs")) autofixRunnerCalls += 1;
          return DEFAULT_STAGED_MARKDOWN_LINT_RUNNER.runAsync(cmd, args, cwd, options);
        },
      };

      await resumePopulatedIntentPublication(run, store, {
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
        runner: spyRunner,
        createBinding: () => ({
          id: "claude/claude-model",
          invoke: async () => {
            writeFileSync(join(workspace, ".jarvis-intent-stage", "bad-intent.md"), FIXED_PREREQUISITES_INTENT, "utf8");
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        }),
      });

      expect(autofixRunnerCalls).toBeGreaterThan(0);
    });
  });

  test("a non-repromptable landing error (rogue path) still settles landing_failed without a reprompt", async () => {
    const workspace = trackedMkdtempSync(join(tmpdir(), "intent-resume-landing-rogue-"));
    mkdirSync(join(workspace, ".jarvis-intent-stage"), { recursive: true });
    writeFileSync(join(workspace, ".jarvis-intent-stage", "good-intent.md"), FIXED_PREREQUISITES_INTENT, "utf8");
    mkdirSync(join(workspace, "ready-intents"), { recursive: true });
    writeFileSync(join(workspace, "stray.txt"), "unrelated change\n", "utf8");

    await withStateStore(async (store) => {
      const branch = "intent/landing-rogue";
      const reviewRunId = seedReviewRow(store, workspace, branch, "intent-landing-rogue");
      const run = store.loadRun(reviewRunId);
      if (!run) throw new Error("expected review run");
      expect(resolveIntentFinalizationResumeContext(run, store)).toMatchObject({ ok: true });

      let invocations = 0;
      const outcome = await resumePopulatedIntentPublication(run, store, {
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
        createBinding: () => ({
          id: "claude/claude-model",
          invoke: async () => {
            invocations += 1;
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        }),
      });

      expect(outcome).toMatchObject({ ok: false });
      expect(invocations).toBe(0);
      const settled = store.loadRun(reviewRunId);
      expect(settled?.status).toBe("failed");
      expect(settled?.terminalCause).toBe("landing_failed");
      expect(existsSync(join(workspace, "ready-intents", "good-intent.md"))).toBe(false);
    });
  });

  test("an unfixed repromptable refusal settles landing_failed only after the write step's maxIterations reprompts are spent", async () => {
    const workspace = trackedMkdtempSync(join(tmpdir(), "intent-resume-landing-exhaust-"));
    mkdirSync(join(workspace, ".jarvis-intent-stage"), { recursive: true });
    writeFileSync(join(workspace, ".jarvis-intent-stage", "bad-intent.md"), PROSE_PREREQUISITES_INTENT, "utf8");
    mkdirSync(join(workspace, "ready-intents"), { recursive: true });

    await withStateStore(async (store) => {
      const branch = "intent/landing-exhaust";
      const queuedInput: WriteLoopInput = {
        ...mockWriteLoopInput({ projectRoot: workspace, projectName: "demo", branchName: branch, baseRef: "none" }),
        maxIterations: 2,
        bindingResolution: {
          role: "plan",
          agents: ["claude"],
          agentModelConfig: { claude: { plan: { rungs: [{ adapterModel: "claude-model", priceKey: "claude" }] } } },
        },
      };
      const reviewRunId = seedReviewRow(store, workspace, branch, "intent-landing-exhaust", queuedInput);
      const run = store.loadRun(reviewRunId);
      if (!run) throw new Error("expected review run");

      const events: LogEvent[] = [];
      let invocations = 0;
      const outcome = await resumePopulatedIntentPublication(run, store, {
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
        logSink: { append: (_runId, event) => events.push(event), close: () => {} },
        createBinding: () => ({
          id: "claude/claude-model",
          invoke: async () => {
            invocations += 1;
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        }),
      });

      expect(outcome).toMatchObject({ ok: false });
      expect(invocations).toBe(2);
      const reprompts = events.filter((event) => event.kind === "landing_contract_reprompt");
      expect(reprompts).toHaveLength(2);
      expect(reprompts[0]).toMatchObject({ offendingFile: expect.stringContaining("bad-intent.md") });
      expect(Object.keys(reprompts[0] ?? {}).sort()).toEqual(["attemptId", "kind", "offendingFile", "violation"]);
      const settled = store.loadRun(reviewRunId);
      expect(settled?.status).toBe("failed");
      expect(settled?.terminalCause).toBe("landing_failed");
      expect(existsSync(join(workspace, "ready-intents", "bad-intent.md"))).toBe(false);
    });
  });
});

describe("review step initial deferred intent landing reprompt", () => {
  const landingFor = (workspace: string) => ({
    kind: "intent-stage" as const,
    output: { durableDir: join(workspace, "ready-intents") },
    stagingDir: ".jarvis-intent-stage",
    invocationId: "inv-initial",
    baseRef: "none",
  });

  // Stands in for the real landing: refuses until the staged file carries a bullet Prerequisites list.
  const fakeLanding = (workspace: string, onCall: () => void) => async () => {
    onCall();
    const staged = readFileSync(join(workspace, ".jarvis-intent-stage", "bad-intent.md"), "utf8");
    return staged === FIXED_PREREQUISITES_INTENT
      ? { ok: true as const, specPath: "ready-intents" }
      : { ok: false as const, message: "intent: bad-intent.md must list prerequisites" };
  };

  function actuatorContext(workspace: string, onInvoke: (prompt: string) => void) {
    return {
      cwd: workspace,
      bindings: [
        {
          id: "claude/claude-model",
          invoke: async ({ prompt }: { prompt: string }) => {
            onInvoke(prompt);
            return { kind: "ok" as const, stdout: "done", stderr: "" };
          },
        },
      ] as unknown as readonly InvocationBinding[],
      resolveActuatorPrompt: async () => "lint reprompt",
    };
  }

  test("prose Prerequisites reprompts the actuator with write.landing-contract-reprompt, then lands the fixed file", async () => {
    const workspace = trackedMkdtempSync(join(tmpdir(), "intent-initial-landing-reprompt-"));
    mkdirSync(join(workspace, ".jarvis-intent-stage"), { recursive: true });
    writeFileSync(join(workspace, ".jarvis-intent-stage", "bad-intent.md"), PROSE_PREREQUISITES_INTENT, "utf8");

    await withStateStore(async (store) => {
      const runId = store.createRun({
        project: "demo",
        specPath: ".jarvis-intent-stage",
        specRef: "main",
        worktreePath: workspace,
        branch: "b",
      });
      const attemptId = store.recordAttemptStart(runId);
      const events: LogEvent[] = [];
      const prompts: string[] = [];
      let landingCalls = 0;
      const outcome = await landReviewedOutputOrFail(
        {
          cwd: workspace,
          verdictPath: join(workspace, "verdict.md"),
          branch: "b",
          project: "demo",
          stagedMarkdownLintMaxReprompts: 3,
        },
        landingFor(workspace),
        attemptId,
        runId,
        1,
        store,
        { append: (_runId, event) => events.push(event), close: () => {} },
        { landReviewedPublicationOutput: fakeLanding(workspace, () => (landingCalls += 1)) },
        actuatorContext(workspace, (prompt) => {
          prompts.push(prompt);
          writeFileSync(join(workspace, ".jarvis-intent-stage", "bad-intent.md"), FIXED_PREREQUISITES_INTENT, "utf8");
        }),
      );

      expect(outcome).toBeUndefined();
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain("must list prerequisites as one bullet per line");
      expect(prompts[0]).toContain("bad-intent.md");
      expect(events.filter((event) => event.kind === "landing_contract_reprompt")).toHaveLength(1);
      expect(landingCalls).toBe(2);
    });
  });

  test("an unfixed repromptable refusal settles the landing failure once the reprompt budget is spent", async () => {
    const workspace = trackedMkdtempSync(join(tmpdir(), "intent-initial-landing-exhaust-"));
    mkdirSync(join(workspace, ".jarvis-intent-stage"), { recursive: true });
    writeFileSync(join(workspace, ".jarvis-intent-stage", "bad-intent.md"), PROSE_PREREQUISITES_INTENT, "utf8");

    await withStateStore(async (store) => {
      const runId = store.createRun({
        project: "demo",
        specPath: ".jarvis-intent-stage",
        specRef: "main",
        worktreePath: workspace,
        branch: "b",
      });
      const attemptId = store.recordAttemptStart(runId);
      let invocations = 0;
      const outcome = await landReviewedOutputOrFail(
        {
          cwd: workspace,
          verdictPath: join(workspace, "verdict.md"),
          branch: "b",
          project: "demo",
          stagedMarkdownLintMaxReprompts: 2,
        },
        landingFor(workspace),
        attemptId,
        runId,
        1,
        store,
        undefined,
        { landReviewedPublicationOutput: fakeLanding(workspace, () => {}) },
        actuatorContext(workspace, () => {
          invocations += 1;
        }),
      );

      expect(invocations).toBe(2);
      expect(outcome).toMatchObject({ kind: "invocation_failure", resumable: true });
      expect(store.loadRun(runId)?.status).toBe("failed");
    });
  });

  test("a rogue path skips the reprompt and settles through the real landing failure", async () => {
    const workspace = trackedMkdtempSync(join(tmpdir(), "intent-initial-landing-rogue-"));
    mkdirSync(join(workspace, ".jarvis-intent-stage"), { recursive: true });
    writeFileSync(join(workspace, ".jarvis-intent-stage", "good-intent.md"), FIXED_PREREQUISITES_INTENT, "utf8");
    writeFileSync(join(workspace, "stray.txt"), "unrelated change\n", "utf8");

    await withStateStore(async (store) => {
      const runId = store.createRun({
        project: "demo",
        specPath: ".jarvis-intent-stage",
        specRef: "main",
        worktreePath: workspace,
        branch: "b",
      });
      const attemptId = store.recordAttemptStart(runId);
      let invocations = 0;
      const outcome = await landReviewedOutputOrFail(
        {
          cwd: workspace,
          verdictPath: join(workspace, "verdict.md"),
          branch: "b",
          project: "demo",
          stagedMarkdownLintMaxReprompts: 3,
        },
        landingFor(workspace),
        attemptId,
        runId,
        1,
        store,
        undefined,
        { landReviewedPublicationOutput: async () => ({ ok: false, message: "intent: splitter wrote outside" }) },
        actuatorContext(workspace, () => {
          invocations += 1;
        }),
      );

      expect(invocations).toBe(0);
      expect(outcome).toMatchObject({ kind: "invocation_failure", resumable: true });
      expect(store.loadRun(runId)?.status).toBe("failed");
    });
  });
});
