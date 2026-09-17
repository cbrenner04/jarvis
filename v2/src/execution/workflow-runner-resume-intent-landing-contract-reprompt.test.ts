import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { StateStore } from "../persistence/state-store.ts";
import { mockWriteLoopInput } from "../testing/run-control.ts";
import { withStateStore } from "../testing/write-fixtures.ts";
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
    const workspace = mkdtempSync(join(tmpdir(), "intent-resume-landing-reprompt-"));
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
    const workspace = mkdtempSync(join(tmpdir(), "intent-resume-landing-runner-"));
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

      // The initial reviewed-staged-markdown lint check (staged-markdown-lint.ts) invokes
      // markdownlint without `--fix`; only the landing gate's autofix (repairIntentStageContent,
      // reached through the guard under test) passes `--fix`. Counting only `--fix` invocations
      // isolates forwarding for that guard from the unrelated, always-forwarded initial check.
      let autofixRunnerCalls = 0;
      const spyRunner: AsyncSubprocessRunner = {
        runAsync: async (cmd, args, cwd, options) => {
          if (args.includes("--fix")) autofixRunnerCalls += 1;
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
    const workspace = mkdtempSync(join(tmpdir(), "intent-resume-landing-rogue-"));
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
});
