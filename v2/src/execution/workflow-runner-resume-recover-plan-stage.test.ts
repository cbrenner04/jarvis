import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvocationResult } from "../../../shared/invocation/execute.ts";
import { planReviewPromptProfile } from "../../../shared/prompts/review-plan.ts";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { trackedMkdtempSync } from "../../../shared/tracked-temp-dir.test-support.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import type { openStateStore } from "../persistence/state-store.ts";
import { withStateStore } from "../testing/write-fixtures.ts";
import {
  createDebateStep,
  doneBindingFactory,
  initGitWorkspace,
  REVIEW_MD_LINT_FIXTURE_IDS,
  readReviewMdLintFixture,
  TestLogSink,
  writeLintCleanPlanStage,
} from "./workflow-runner.test-support.ts";
import { executeWorkflow, type ReviewWorkflowStep, type WriteWorkflowStep } from "./workflow-runner.ts";
import { DEFAULT_STAGED_MARKDOWN_LINT_RUNNER, planRecoveryLanding } from "./workflow-runner-resume.test-support.ts";
import { recoverPlanStage } from "./workflow-runner-resume.ts";

describe("recoverPlanStage", () => {
  const PLAN_REVIEW_CONFIG: AgentModelConfig = {
    claude: { critic: { rungs: [{ adapterModel: "critic", priceKey: "critic" }] } },
    codex: { actuator: { rungs: [{ adapterModel: "actuator", priceKey: "actuator" }] } },
  };
  const PLAN_WRITE_AGENT_MODEL_CONFIG: AgentModelConfig = {
    claude: { plan: { rungs: [{ adapterModel: "plan", priceKey: "plan" }] } },
  };

  const harnessPlanBlocker = (reason: string) => `\n## Blocker\n\nArtifact contract check failed: ${reason}\n`;

  function planWorktree(prefix: string): string {
    const worktree = initGitWorkspace(prefix);
    // Recovery's commit tail needs a real HEAD to commit against.
    execFileSync("git", ["commit", "--allow-empty", "-qm", "base"], { cwd: worktree });
    return worktree;
  }

  function noGitPlanWorktree(prefix: string): string {
    return trackedMkdtempSync(join(tmpdir(), prefix));
  }

  function planWriteStep(args: {
    stepId: string;
    branch: string;
    worktreePath: string;
    specPath: string;
  }): WriteWorkflowStep {
    return {
      behavior: "write",
      stepId: args.stepId,
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
      createBinding: doneBindingFactory,
    };
  }

  function seedBlockedPlanDraftRun(
    store: ReturnType<typeof openStateStore>,
    args: {
      project: string;
      branch: string;
      worktreePath: string;
      specPath: string;
      stepId: string;
      invocationId: string;
      outcomeKind: "contract_miss" | "blocked" | "landing_failed";
      expectedArtifactPath?: string;
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
            expectedArtifactPath: args.expectedArtifactPath ?? ".jarvis-plan-stage",
            agents: ["claude"],
          },
        ],
      },
    });
    const attemptId = store.recordAttemptStart(runId);
    const runStatus = args.outcomeKind === "landing_failed" ? "failed" : "blocked";
    store.commitCompletionBoundary({ attemptId, runStatus, outcomeKind: args.outcomeKind });
    return runId;
  }

  function planReviewStep(args: {
    worktreePath: string;
    stage: string;
    durable: string;
    branch: string;
    invoke: (agentId: string) => Promise<InvocationResult>;
    inputs?: { sourceRoot: string; paths: string[]; consumeFrom: "worktree" | "source" };
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
      landing: {
        kind: "plan-tree",
        stagingDir: ".jarvis-plan-stage",
        durablePath: args.durable,
        ...(args.inputs !== undefined ? { inputs: args.inputs } : {}),
      },
      createBinding: ({ agentId }) => ({
        id: agentId,
        metadata: { agent: agentId, model: agentId },
        invoke: async () => args.invoke(agentId),
      }),
    };
  }

  function seedSourceReadyIntent(prefix: string): { sourceRoot: string; path: string } {
    const sourceRoot = trackedMkdtempSync(join(tmpdir(), prefix));
    mkdirSync(join(sourceRoot, "ready-intents"), { recursive: true });
    const path = join(sourceRoot, "ready-intents", "test.md");
    writeFileSync(path, "---\nname: test\n---\n\n## Prerequisites\n", "utf8");
    return { sourceRoot, path };
  }

  /** Byte-for-byte snapshot of a staging directory's top-level files, for retention assertions. */
  function readStageFiles(stage: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const name of readdirSync(stage)) {
      result[name] = readFileSync(join(stage, name), "utf8");
    }
    return result;
  }

  test("recovers an operator-edited plan stage through publication without redrafting", async () => {
    const worktreePath = planWorktree("recover-plan-stage-keystone-");
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const durable = join(worktreePath, "spec", "2026-recovered-plan");
    const branch = "recover-plan-stage-keystone";
    const stepId = "plan";
    const specPath = "spec/2026-recovered-plan";
    const reason = "`## Decisions` bullet is outside the allowed union";
    const agentDraftBody = "# Draft with an out-of-union Decisions bullet\n";

    writeLintCleanPlanStage(stage, "00-first.md");
    writeFileSync(join(stage, "00-first.md"), agentDraftBody, "utf8");
    writeFileSync(join(stage, "intent.md"), `---\nname: test\n---\n${harnessPlanBlocker(reason)}`, "utf8");
    const { sourceRoot, path: sourceReadyIntent } = seedSourceReadyIntent("recover-plan-stage-keystone-source-");

    const correctedSubspecBody = readReviewMdLintFixture(REVIEW_MD_LINT_FIXTURE_IDS.planMd012CleanSubspec);
    const reviewerCalls: string[] = [];

    await withStateStore(async (store) => {
      const runId = seedBlockedPlanDraftRun(store, {
        project: "demo",
        branch,
        worktreePath,
        specPath,
        stepId,
        invocationId: "recover-plan-stage-keystone-inv",
        outcomeKind: "contract_miss",
      });
      const logSink = new TestLogSink();
      logSink.append(runId, {
        kind: "contract_miss_detail",
        attemptId: "attempt-1",
        failedContractId: "plan.decisions-shape",
        responseText: "done",
        failureReason: reason,
      });

      // Operator corrects the staged subspec that tripped the contract miss; the on-disk tree
      // now differs from the agent's original draft.
      writeFileSync(join(stage, "00-first.md"), correctedSubspecBody, "utf8");
      // Captured before landing consumes the stage.
      const stagedIndexBody = readFileSync(join(stage, "index.md"), "utf8");

      const reviewStep = planReviewStep({
        worktreePath,
        stage,
        durable,
        branch,
        // Pre-fix, recovery dispatched this actuator, which regenerated the agent's original
        // draft over the operator's correction (the bug this subspec fixes). Post-fix, recovery
        // never calls it, so the on-disk correction lands byte-identical.
        invoke: async (agentId) => {
          reviewerCalls.push(agentId);
          if (agentId === "codex") writeFileSync(join(stage, "00-first.md"), agentDraftBody, "utf8");
          return { kind: "ok", stdout: agentId === "claude" ? "Looks good" : "done", stderr: "" };
        },
        inputs: { sourceRoot, paths: [sourceReadyIntent], consumeFrom: "source" },
      });

      const outcome = await recoverPlanStage({
        runId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        recoveryLanding: planRecoveryLanding(reviewStep),
        stateStore: store,
        logSink,
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
      });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error("unreachable");
      expect(outcome.kind).toBe("complete");
      expect(reviewerCalls).toEqual([]);
      // The durable tree must be the operator's tree, whole: asserting one file's bytes would still
      // pass if landing dropped a file, added one, or rewrote `index.md`.
      expect(readdirSync(durable).sort()).toEqual(["00-first.md", "index.md", "intent.md"]);
      expect(readFileSync(join(durable, "00-first.md"), "utf8")).toBe(correctedSubspecBody);
      expect(readFileSync(join(durable, "index.md"), "utf8")).toBe(stagedIndexBody);
      expect(readFileSync(join(durable, "intent.md"), "utf8")).not.toContain("## Blocker");
      expect(existsSync(sourceReadyIntent)).toBe(false);

      const writeRun = store.loadRun(runId);
      expect(writeRun?.status).toBe("blocked");
      expect(writeRun?.attempts.length).toBe(1);
    });
  });

  test("recovered plan publication commits only durable output", async () => {
    const worktreePath = planWorktree("recover-plan-stage-commit-clean-");
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const durable = join(worktreePath, "spec", "2026-commit-clean");
    const branch = "recover-plan-stage-commit-clean";
    const stepId = "plan";
    const specPath = "spec/2026-commit-clean";
    const reason = "`## Decisions` bullet is outside the allowed union";

    writeLintCleanPlanStage(stage, "00-first.md");
    writeFileSync(join(stage, "00-first.md"), "# Draft with an out-of-union Decisions bullet\n", "utf8");
    writeFileSync(join(stage, "intent.md"), `---\nname: test\n---\n${harnessPlanBlocker(reason)}`, "utf8");

    // Ready-intent lives inside this worktree (not an external source root) so its consumption
    // deletion lands in the same commit range as the durable landing.
    mkdirSync(join(worktreePath, "ready-intents"), { recursive: true });
    const readyIntentPath = join(worktreePath, "ready-intents", "test.md");
    writeFileSync(readyIntentPath, "---\nname: test\n---\n\n## Prerequisites\n", "utf8");
    execFileSync("git", ["add", "."], { cwd: worktreePath });
    execFileSync("git", ["commit", "-qm", "seed ready-intent"], { cwd: worktreePath });

    const correctedSubspecBody = readReviewMdLintFixture(REVIEW_MD_LINT_FIXTURE_IDS.planMd012CleanSubspec);

    await withStateStore(async (store) => {
      const runId = seedBlockedPlanDraftRun(store, {
        project: "demo",
        branch,
        worktreePath,
        specPath,
        stepId,
        invocationId: "recover-plan-stage-commit-clean-inv",
        outcomeKind: "contract_miss",
      });
      const logSink = new TestLogSink();
      logSink.append(runId, {
        kind: "contract_miss_detail",
        attemptId: "attempt-1",
        failedContractId: "plan.decisions-shape",
        responseText: "done",
        failureReason: reason,
      });

      // Operator corrects the staged subspec that tripped the contract miss.
      writeFileSync(join(stage, "00-first.md"), correctedSubspecBody, "utf8");

      const reviewStep = planReviewStep({
        worktreePath,
        stage,
        durable,
        branch,
        invoke: async (agentId) => ({ kind: "ok", stdout: agentId === "claude" ? "Looks good" : "done", stderr: "" }),
        inputs: { sourceRoot: worktreePath, paths: [readyIntentPath], consumeFrom: "worktree" },
      });

      const preRunHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: worktreePath, encoding: "utf8" }).trim();

      const outcome = await recoverPlanStage({
        runId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        recoveryLanding: planRecoveryLanding(reviewStep),
        stateStore: store,
        logSink,
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
      });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error("unreachable");
      expect(outcome.kind).toBe("complete");
      expect(outcome.commitSha).toBeDefined();
      expect(readFileSync(join(durable, "00-first.md"), "utf8")).toBe(correctedSubspecBody);
      expect(readFileSync(join(durable, "intent.md"), "utf8")).not.toContain("## Blocker");
      expect(existsSync(join(durable, "verdict-plan.md"))).toBe(false);
      expect(existsSync(readyIntentPath)).toBe(false);

      const commitsInRange = execFileSync("git", ["rev-list", `${preRunHead}..HEAD`], {
        cwd: worktreePath,
        encoding: "utf8",
      })
        .trim()
        .split("\n")
        .filter(Boolean);
      expect(commitsInRange.length).toBeGreaterThan(0);
      for (const sha of commitsInRange) {
        const tracked = execFileSync("git", ["ls-tree", "-r", "--name-only", sha], {
          cwd: worktreePath,
          encoding: "utf8",
        });
        expect(tracked).not.toContain(".jarvis-plan-stage");
        expect(tracked).not.toContain("verdict-plan.md");
        expect(tracked).not.toContain(".owner");
        expect(tracked).not.toContain(".jarvis-plan-backup");
      }

      const finalTracked = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], {
        cwd: worktreePath,
        encoding: "utf8",
      });
      expect(finalTracked).toContain("spec/2026-commit-clean/00-first.md");
      expect(finalTracked).toContain("spec/2026-commit-clean/index.md");
      expect(finalTracked).toContain("spec/2026-commit-clean/intent.md");
      expect(finalTracked).not.toContain("ready-intents/test.md");
    });
  });

  test("lands via a captured review-debate step's plan-tree landing config", async () => {
    // Recovery's landing-step lookup accepts either a "review" or a "review-debate" captured
    // step; the other tests in this suite only exercise "review". A review-debate step never
    // short-circuits the "review" behavior check, so this is the only case that actually
    // evaluates the "review-debate" comparison.
    const worktreePath = planWorktree("recover-plan-stage-review-debate-");
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const durable = join(worktreePath, "spec", "2026-review-debate");
    const branch = "recover-plan-stage-review-debate";
    const stepId = "plan";
    const specPath = "spec/2026-review-debate";
    const reason = "`## Decisions` bullet is outside the allowed union";

    writeLintCleanPlanStage(stage, "00-first.md");
    writeFileSync(join(stage, "intent.md"), `---\nname: test\n---\n${harnessPlanBlocker(reason)}`, "utf8");

    await withStateStore(async (store) => {
      const runId = seedBlockedPlanDraftRun(store, {
        project: "demo",
        branch,
        worktreePath,
        specPath,
        stepId,
        invocationId: "recover-plan-stage-review-debate-inv",
        outcomeKind: "contract_miss",
      });
      const logSink = new TestLogSink();
      logSink.append(runId, {
        kind: "contract_miss_detail",
        attemptId: "attempt-1",
        failedContractId: "plan.decisions-shape",
        responseText: "done",
        failureReason: reason,
      });

      const reviewStep = createDebateStep({
        stepId: "plan-review",
        branch,
        project: "demo",
        cwd: worktreePath,
        verdictPath: join(stage, "verdict-plan.md"),
        landing: { kind: "plan-tree", stagingDir: ".jarvis-plan-stage", durablePath: durable },
      });

      const outcome = await recoverPlanStage({
        runId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        recoveryLanding: planRecoveryLanding(reviewStep),
        stateStore: store,
        logSink,
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
      });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error("unreachable");
      expect(outcome.kind).toBe("complete");
      expect(existsSync(join(durable, "00-first.md"))).toBe(true);
      expect(readFileSync(join(durable, "intent.md"), "utf8")).not.toContain("## Blocker");
    });
  });

  test("a request with no plan-tree landing step refuses without touching the staged tree", async () => {
    const worktreePath = planWorktree("recover-plan-stage-no-landing-");
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const branch = "recover-plan-stage-no-landing";
    const stepId = "plan";
    const specPath = "spec/2026-no-landing";

    writeLintCleanPlanStage(stage, "00-first.md");
    const stagedIntentBody = readFileSync(join(stage, "intent.md"), "utf8");

    await withStateStore(async (store) => {
      const runId = seedBlockedPlanDraftRun(store, {
        project: "demo",
        branch,
        worktreePath,
        specPath,
        stepId,
        invocationId: "recover-plan-stage-no-landing-inv",
        outcomeKind: "blocked",
      });

      // A captured review step whose landing is not a plan tree: the stage is recoverable, but the
      // request carries nothing to land it with.
      const nonPlanLandingStep = {
        ...planReviewStep({
          worktreePath,
          stage,
          durable: join(worktreePath, "spec", "2026-no-landing"),
          branch,
          invoke: async () => {
            throw new Error("recovery must not dispatch a review role");
          },
        }),
        landing: { kind: "intent-stage" as const, stagingDir: ".jarvis-intent-stage" },
      } as unknown as ReviewWorkflowStep;

      const outcome = await recoverPlanStage({
        runId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        recoveryLanding: nonPlanLandingStep as never,
        stateStore: store,
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
      });

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("unreachable");
      // `plan_stage_invalid` would send the operator hunting through markdown that is fine.
      expect(outcome.code).not.toBe("plan_stage_invalid");
      expect(outcome.message).toContain("no plan-tree landing captured");
      // Refused ahead of the blocker strip, so the operator's tree is untouched.
      expect(readFileSync(join(stage, "intent.md"), "utf8")).toBe(stagedIntentBody);
    });
  });

  test("a landing collision surfaces as an invocation failure without dispatching a role", async () => {
    const worktreePath = planWorktree("recover-plan-stage-landing-conflict-");
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const durable = join(worktreePath, "spec", "2026-landing-conflict");
    const branch = "recover-plan-stage-landing-conflict";
    const stepId = "plan";
    const specPath = "spec/2026-landing-conflict";

    writeLintCleanPlanStage(stage, "00-first.md");
    const stagedIndexBody = readFileSync(join(stage, "index.md"), "utf8");
    const stagedSubspecBody = readFileSync(join(stage, "00-first.md"), "utf8");
    const stagedIntentBody = readFileSync(join(stage, "intent.md"), "utf8");
    // The staged tree passes admission and pre-landing validation on its own; the durable
    // destination already carries a same-named file with different bytes, a collision `landPublication`
    // itself, not the earlier checks, catches.
    mkdirSync(durable, { recursive: true });
    writeFileSync(join(durable, "index.md"), "# Pre-existing conflicting index\n", "utf8");

    await withStateStore(async (store) => {
      const runId = seedBlockedPlanDraftRun(store, {
        project: "demo",
        branch,
        worktreePath,
        specPath,
        stepId,
        invocationId: "recover-plan-stage-landing-conflict-inv",
        outcomeKind: "contract_miss",
      });

      const reviewStep = planReviewStep({
        worktreePath,
        stage,
        durable,
        branch,
        invoke: async () => {
          throw new Error("recovery must not dispatch a review role");
        },
      });

      const outcome = await recoverPlanStage({
        runId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        recoveryLanding: planRecoveryLanding(reviewStep),
        stateStore: store,
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
      });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error("unreachable");
      expect(outcome.kind).toBe("invocation_failure");
      expect(outcome.invocationFailureMessage).toContain("already exists with different contents");
      // A failed landing must leave the operator's tree exactly as they left it: a half-consumed
      // stage is the thing recovery exists to avoid.
      expect(existsSync(join(stage, "index.md"))).toBe(true);
      expect(readFileSync(join(stage, "index.md"), "utf8")).toBe(stagedIndexBody);
      expect(readFileSync(join(stage, "00-first.md"), "utf8")).toBe(stagedSubspecBody);
      expect(readFileSync(join(stage, "intent.md"), "utf8")).toBe(stagedIntentBody);
    });
  });

  test("admits corrected plan stage despite a non-resumable stop", async () => {
    for (const outcomeKind of ["contract_miss", "blocked"] as const) {
      const worktreePath = planWorktree(`recover-plan-stage-nonresumable-${outcomeKind}-`);
      const stage = join(worktreePath, ".jarvis-plan-stage");
      const durable = join(worktreePath, "spec", `2026-recovered-${outcomeKind}`);
      const branch = `recover-plan-stage-nonresumable-${outcomeKind}`;
      const stepId = "plan";
      const specPath = `spec/2026-recovered-${outcomeKind}`;
      writeLintCleanPlanStage(stage, "00-first.md");

      await withStateStore(async (store) => {
        const runId = seedBlockedPlanDraftRun(store, {
          project: "demo",
          branch,
          worktreePath,
          specPath,
          stepId,
          invocationId: `recover-plan-stage-nonresumable-${outcomeKind}-inv`,
          outcomeKind,
        });

        // Ordinary resume stays refused: replaying the same write step through `executeWorkflow`
        // still reports the idempotent terminal outcome with `resumable: false`.
        const writeStep = planWriteStep({ stepId, branch, worktreePath, specPath });
        const ordinaryResume = await executeWorkflow({ steps: [writeStep], stateStore: store });
        expect(ordinaryResume).toMatchObject({ kind: outcomeKind, resumable: false });

        const reviewStep = planReviewStep({
          worktreePath,
          stage,
          durable,
          branch,
          invoke: async (agentId) => ({ kind: "ok", stdout: agentId === "claude" ? "ok" : "done", stderr: "" }),
        });

        const outcome = await recoverPlanStage({
          runId,
          project: "demo",
          branch,
          worktreePath,
          writeStepId: stepId,
          recoveryLanding: planRecoveryLanding(reviewStep),
          stateStore: store,
          runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
        });

        expect(outcome.ok).toBe(true);
        if (outcome.ok) expect(outcome.kind).toBe("complete");
      });
    }
  });

  test("refuses recovery with missing or mismatched plan context", async () => {
    const worktreePath = planWorktree("recover-plan-stage-refusal-");
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const durable = join(worktreePath, "spec", "2026-refusal");
    const branch = "recover-plan-stage-refusal";
    const stepId = "plan";
    const specPath = "spec/2026-refusal";
    writeLintCleanPlanStage(stage, "00-first.md");
    const { path: sourceReadyIntent } = seedSourceReadyIntent("recover-plan-stage-refusal-source-");

    const spyReviewStep = (): ReviewWorkflowStep =>
      planReviewStep({
        worktreePath,
        stage,
        durable,
        branch,
        invoke: async () => {
          throw new Error("review must not run on a refused recovery");
        },
      });

    await withStateStore(async (store) => {
      // Missing captured context: no persisted run for the named runId at all.
      const missing = await recoverPlanStage({
        runId: "does-not-exist",
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        recoveryLanding: planRecoveryLanding(spyReviewStep()),
        stateStore: store,
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
      });
      expect(missing).toMatchObject({ ok: false, code: "missing_plan_context" });

      const runId = seedBlockedPlanDraftRun(store, {
        project: "demo",
        branch,
        worktreePath,
        specPath,
        stepId,
        invocationId: "recover-plan-stage-refusal-inv",
        outcomeKind: "contract_miss",
      });

      // Run/step identity mismatch: the captured branch disagrees with the persisted run.
      const mismatched = await recoverPlanStage({
        runId,
        project: "demo",
        branch: "some-other-branch",
        worktreePath,
        writeStepId: stepId,
        recoveryLanding: planRecoveryLanding(spyReviewStep()),
        stateStore: store,
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
      });
      expect(mismatched).toMatchObject({ ok: false, code: "stage_identity_mismatch" });

      // Unrelated populated stage: a different, also-blocked workflow step's row shares the same
      // worktree/branch and coincidentally sees the populated plan stage, but its own captured
      // step never identified a plan-draft artifact.
      const unrelatedRunId = store.createRun({
        project: "demo",
        specRef: "HEAD",
        worktreePath,
        branch,
        specPath,
        stepId: "implement",
        workflowSnapshot: {
          invocationId: "unrelated-inv",
          steps: [{ stepId: "implement", role: "implement", expectedArtifactPath: "proof.txt" }],
        },
      });
      const unrelatedAttemptId = store.recordAttemptStart(unrelatedRunId);
      store.commitCompletionBoundary({ attemptId: unrelatedAttemptId, runStatus: "blocked", outcomeKind: "blocked" });
      const unrelated = await recoverPlanStage({
        runId: unrelatedRunId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: "implement",
        recoveryLanding: planRecoveryLanding(spyReviewStep()),
        stateStore: store,
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
      });
      expect(unrelated).toMatchObject({ ok: false, code: "unrelated_plan_stage" });

      expect(existsSync(sourceReadyIntent)).toBe(true);
      expect(existsSync(stage)).toBe(true);
      expect(existsSync(durable)).toBe(false);
    });
  });

  test("retains operator blockers and removes only captured harness blockers during recovery", async () => {
    const matchReason = "harness contract reason";

    // A proven, exactly-matching harness blocker is stripped before landing and never blocks
    // admission.
    {
      const worktreePath = planWorktree("recover-plan-stage-blocker-match-");
      const stage = join(worktreePath, ".jarvis-plan-stage");
      const durable = join(worktreePath, "spec", "2026-blocker-match");
      const branch = "recover-plan-stage-blocker-match";
      const stepId = "plan";
      const specPath = "spec/2026-blocker-match";
      writeLintCleanPlanStage(stage, "00-first.md");
      writeFileSync(join(stage, "intent.md"), `---\nname: test\n---\n${harnessPlanBlocker(matchReason)}`, "utf8");

      await withStateStore(async (store) => {
        const runId = seedBlockedPlanDraftRun(store, {
          project: "demo",
          branch,
          worktreePath,
          specPath,
          stepId,
          invocationId: "recover-plan-stage-blocker-match-inv",
          outcomeKind: "contract_miss",
        });
        const logSink = new TestLogSink();
        logSink.append(runId, {
          kind: "contract_miss_detail",
          attemptId: "attempt-1",
          failedContractId: "plan.decisions-shape",
          responseText: "done",
          failureReason: matchReason,
        });

        const reviewStep = planReviewStep({
          worktreePath,
          stage,
          durable,
          branch,
          invoke: async (agentId) => ({ kind: "ok", stdout: agentId === "claude" ? "ok" : "done", stderr: "" }),
        });

        const outcome = await recoverPlanStage({
          runId,
          project: "demo",
          branch,
          worktreePath,
          writeStepId: stepId,
          recoveryLanding: planRecoveryLanding(reviewStep),
          stateStore: store,
          logSink,
          runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
        });

        expect(outcome).toMatchObject({ ok: true, kind: "complete" });
        expect(existsSync(join(durable, "intent.md"))).toBe(true);
        expect(readFileSync(join(durable, "intent.md"), "utf8")).not.toContain("## Blocker");
      });
    }

    // A changed reason no longer proves harness authorship: the blocker is retained and refused.
    {
      const worktreePath = planWorktree("recover-plan-stage-blocker-changed-");
      const stage = join(worktreePath, ".jarvis-plan-stage");
      const durable = join(worktreePath, "spec", "2026-blocker-changed");
      const branch = "recover-plan-stage-blocker-changed";
      const stepId = "plan";
      const specPath = "spec/2026-blocker-changed";
      writeLintCleanPlanStage(stage, "00-first.md");
      const stagedIntent = `---\nname: test\n---\n${harnessPlanBlocker(matchReason)}`;
      writeFileSync(join(stage, "intent.md"), stagedIntent, "utf8");

      await withStateStore(async (store) => {
        const runId = seedBlockedPlanDraftRun(store, {
          project: "demo",
          branch,
          worktreePath,
          specPath,
          stepId,
          invocationId: "recover-plan-stage-blocker-changed-inv",
          outcomeKind: "contract_miss",
        });
        const logSink = new TestLogSink();
        logSink.append(runId, {
          kind: "contract_miss_detail",
          attemptId: "attempt-1",
          failedContractId: "plan.decisions-shape",
          responseText: "done",
          failureReason: "a different reason than what is staged",
        });

        const reviewStep = planReviewStep({
          worktreePath,
          stage,
          durable,
          branch,
          invoke: async () => {
            throw new Error("review must not run on a refused recovery");
          },
        });

        const outcome = await recoverPlanStage({
          runId,
          project: "demo",
          branch,
          worktreePath,
          writeStepId: stepId,
          recoveryLanding: planRecoveryLanding(reviewStep),
          stateStore: store,
          logSink,
          runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
        });

        expect(outcome).toMatchObject({ ok: false, code: "operator_blocker" });
        expect(readFileSync(join(stage, "intent.md"), "utf8")).toBe(stagedIntent);
        expect(existsSync(durable)).toBe(false);
      });
    }

    // A genuinely `blocked`-kind stop never carries harness metadata: any blocker present is
    // agent/operator-authored, retained and refused.
    {
      const worktreePath = planWorktree("recover-plan-stage-blocker-agent-");
      const stage = join(worktreePath, ".jarvis-plan-stage");
      const durable = join(worktreePath, "spec", "2026-blocker-agent");
      const branch = "recover-plan-stage-blocker-agent";
      const stepId = "plan";
      const specPath = "spec/2026-blocker-agent";
      writeLintCleanPlanStage(stage, "00-first.md");
      const stagedIntent = "---\nname: test\n---\n\n## Blocker\n\nNeed clarification on scope.\n";
      writeFileSync(join(stage, "intent.md"), stagedIntent, "utf8");

      await withStateStore(async (store) => {
        const runId = seedBlockedPlanDraftRun(store, {
          project: "demo",
          branch,
          worktreePath,
          specPath,
          stepId,
          invocationId: "recover-plan-stage-blocker-agent-inv",
          outcomeKind: "blocked",
        });

        const reviewStep = planReviewStep({
          worktreePath,
          stage,
          durable,
          branch,
          invoke: async () => {
            throw new Error("review must not run on a refused recovery");
          },
        });

        const outcome = await recoverPlanStage({
          runId,
          project: "demo",
          branch,
          worktreePath,
          writeStepId: stepId,
          recoveryLanding: planRecoveryLanding(reviewStep),
          stateStore: store,
          runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
        });

        expect(outcome).toMatchObject({ ok: false, code: "operator_blocker" });
        expect(readFileSync(join(stage, "intent.md"), "utf8")).toBe(stagedIntent);
      });
    }
  });

  test("retains a proven harness blocker when structural validation refuses recovery", async () => {
    const worktreePath = planWorktree("recover-plan-stage-invalid-before-strip-");
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const durable = join(worktreePath, "spec", "2026-invalid-before-strip");
    const branch = "recover-plan-stage-invalid-before-strip";
    const stepId = "plan";
    const specPath = "spec/2026-invalid-before-strip";
    const reason = "missing index";
    const blocker = harnessPlanBlocker(reason);
    const stagedIntent = `---\nname: test\n---\n${blocker}`;

    writeLintCleanPlanStage(stage, "00-first.md");
    writeFileSync(join(stage, "intent.md"), stagedIntent, "utf8");
    rmSync(join(stage, "index.md"));

    await withStateStore(async (store) => {
      const runId = seedBlockedPlanDraftRun(store, {
        project: "demo",
        branch,
        worktreePath,
        specPath,
        stepId,
        invocationId: "recover-plan-stage-invalid-before-strip-inv",
        outcomeKind: "contract_miss",
      });
      const logSink = new TestLogSink();
      logSink.append(runId, {
        kind: "contract_miss_detail",
        attemptId: "attempt-1",
        failedContractId: "plan.draft.shape",
        responseText: "done",
        failureReason: reason,
      });
      const reviewStep = planReviewStep({
        worktreePath,
        stage,
        durable,
        branch,
        invoke: async () => {
          throw new Error("review must not run on a structurally invalid recovered plan stage");
        },
      });

      const outcome = await recoverPlanStage({
        runId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        recoveryLanding: planRecoveryLanding(reviewStep),
        stateStore: store,
        logSink,
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
      });

      expect(outcome).toMatchObject({ ok: false, code: "plan_stage_invalid" });
      expect(readFileSync(join(stage, "intent.md"), "utf8")).toBe(stagedIntent);
      expect(readFileSync(join(stage, "intent.md"), "utf8").endsWith(blocker)).toBe(true);
      expect(existsSync(durable)).toBe(false);
    });
  });

  test("retains staged intent bytes when lint validation refuses recovery", async () => {
    const worktreePath = planWorktree("recover-plan-stage-lint-before-strip-");
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const durable = join(worktreePath, "spec", "2026-lint-before-strip");
    const branch = "recover-plan-stage-lint-before-strip";
    const stepId = "plan";
    const specPath = "spec/2026-lint-before-strip";
    const reason = "lint violation";
    const stagedIntent = `---\nname: test\n---\n${harnessPlanBlocker(reason)}`;

    writeLintCleanPlanStage(stage, "00-first.md");
    writeFileSync(join(stage, "intent.md"), stagedIntent, "utf8");
    writeFileSync(
      join(stage, "00-first.md"),
      readReviewMdLintFixture(REVIEW_MD_LINT_FIXTURE_IDS.planMd038ViolationSubspec),
      "utf8",
    );

    await withStateStore(async (store) => {
      const runId = seedBlockedPlanDraftRun(store, {
        project: "demo",
        branch,
        worktreePath,
        specPath,
        stepId,
        invocationId: "recover-plan-stage-lint-before-strip-inv",
        outcomeKind: "contract_miss",
      });
      const logSink = new TestLogSink();
      logSink.append(runId, {
        kind: "contract_miss_detail",
        attemptId: "attempt-1",
        failedContractId: "plan.markdownlint",
        responseText: "done",
        failureReason: reason,
      });
      const reviewStep = planReviewStep({
        worktreePath,
        stage,
        durable,
        branch,
        invoke: async () => {
          throw new Error("review must not run on a lint-invalid recovered plan stage");
        },
      });

      const outcome = await recoverPlanStage({
        runId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        recoveryLanding: planRecoveryLanding(reviewStep),
        stateStore: store,
        logSink,
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
      });

      expect(outcome).toMatchObject({ ok: false, code: "plan_stage_invalid" });
      expect(outcome).toMatchObject({ message: expect.stringContaining("MD038") });
      expect(readFileSync(join(stage, "intent.md"), "utf8")).toBe(stagedIntent);
      expect(existsSync(durable)).toBe(false);
    });
  });

  test("uses the injected runner for plan-recovery staged lint", async () => {
    const worktreePath = planWorktree("recover-plan-stage-lint-runner-seam-");
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const durable = join(worktreePath, "spec", "2026-lint-runner-seam");
    const branch = "recover-plan-stage-lint-runner-seam";
    const stepId = "plan";
    const specPath = "spec/2026-lint-runner-seam";
    writeLintCleanPlanStage(stage, "00-first.md");

    const calls: string[][] = [];
    const runner: AsyncSubprocessRunner = {
      runAsync: async (_cmd, args) => {
        calls.push(args);
        const stagedFile = args.at(-1) ?? "";
        return `${stagedFile}:1 MD999/stub-rule stub violation from injected runner`;
      },
    };

    await withStateStore(async (store) => {
      const runId = seedBlockedPlanDraftRun(store, {
        project: "demo",
        branch,
        worktreePath,
        specPath,
        stepId,
        invocationId: "recover-plan-stage-lint-runner-seam-inv",
        outcomeKind: "contract_miss",
      });
      const logSink = new TestLogSink();
      logSink.append(runId, {
        kind: "contract_miss_detail",
        attemptId: "attempt-1",
        failedContractId: "plan.draft.shape",
        responseText: "done",
        failureReason: "reason",
      });
      const reviewStep = planReviewStep({
        worktreePath,
        stage,
        durable,
        branch,
        invoke: async () => {
          throw new Error("review must not run when the injected lint runner reports a violation");
        },
      });

      // Mutation checkpoint: dropping the `runner` forward into `lintPlanRecoveryStage` must turn
      // this RED (the injected stub never sees a call; the real markdownlint binary runs instead).
      const outcome = await recoverPlanStage({
        runId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        recoveryLanding: planRecoveryLanding(reviewStep),
        stateStore: store,
        logSink,
        runner,
      });

      expect(calls).toHaveLength(1);
      expect(outcome).toMatchObject({
        ok: false,
        code: "plan_stage_invalid",
        message: expect.stringContaining("MD999"),
      });
      expect(existsSync(durable)).toBe(false);
    });
  });

  test("uses the injected runner for plan-recovery staged lint with a proven harness blocker", async () => {
    const matchReason = "harness contract reason for the injected-runner copy path";
    const worktreePath = planWorktree("recover-plan-stage-lint-runner-seam-harness-");
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const durable = join(worktreePath, "spec", "2026-lint-runner-seam-harness");
    const branch = "recover-plan-stage-lint-runner-seam-harness";
    const stepId = "plan";
    const specPath = "spec/2026-lint-runner-seam-harness";
    writeLintCleanPlanStage(stage, "00-first.md");
    writeFileSync(join(stage, "intent.md"), `---\nname: test\n---\n${harnessPlanBlocker(matchReason)}`, "utf8");

    const calls: string[][] = [];
    const runner: AsyncSubprocessRunner = {
      runAsync: async (_cmd, args) => {
        calls.push(args);
        const stagedFile = args.at(-1) ?? "";
        return `${stagedFile}:1 MD999/stub-rule stub violation from injected runner`;
      },
    };

    await withStateStore(async (store) => {
      const runId = seedBlockedPlanDraftRun(store, {
        project: "demo",
        branch,
        worktreePath,
        specPath,
        stepId,
        invocationId: "recover-plan-stage-lint-runner-seam-harness-inv",
        outcomeKind: "contract_miss",
      });
      const logSink = new TestLogSink();
      logSink.append(runId, {
        kind: "contract_miss_detail",
        attemptId: "attempt-1",
        failedContractId: "plan.decisions-shape",
        responseText: "done",
        failureReason: matchReason,
      });
      const reviewStep = planReviewStep({
        worktreePath,
        stage,
        durable,
        branch,
        invoke: async () => {
          throw new Error("review must not run when the injected lint runner reports a violation");
        },
      });

      // Mutation checkpoint: dropping the `runner` forward into the harness-copy branch of
      // `lintPlanRecoveryStage` must turn this RED (the injected stub never sees a call; the
      // real markdownlint binary runs against the copied worktree instead).
      const outcome = await recoverPlanStage({
        runId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        recoveryLanding: planRecoveryLanding(reviewStep),
        stateStore: store,
        logSink,
        runner,
      });

      expect(calls).toHaveLength(1);
      expect(outcome).toMatchObject({
        ok: false,
        code: "plan_stage_invalid",
        message: expect.stringContaining("MD999"),
      });
      expect(existsSync(durable)).toBe(false);
    });
  });

  test("refuses Git-disabled plan-stage recovery", async () => {
    const worktreePath = noGitPlanWorktree("recover-plan-stage-no-git-");
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const durable = join(worktreePath, "spec", "2026-no-git");
    const branch = "recover-plan-stage-no-git";
    const stepId = "plan";
    const specPath = "spec/2026-no-git";
    writeLintCleanPlanStage(stage, "00-first.md");
    const { sourceRoot, path: sourceReadyIntent } = seedSourceReadyIntent("recover-plan-stage-no-git-source-");

    await withStateStore(async (store) => {
      const runId = seedBlockedPlanDraftRun(store, {
        project: "demo",
        branch,
        worktreePath,
        specPath,
        stepId,
        invocationId: "recover-plan-stage-no-git-inv",
        outcomeKind: "contract_miss",
      });

      const reviewStep = planReviewStep({
        worktreePath,
        stage,
        durable,
        branch,
        invoke: async () => {
          throw new Error("review must not run when recovery refuses Git-disabled mode");
        },
        inputs: { sourceRoot, paths: [sourceReadyIntent], consumeFrom: "source" },
      });

      const outcome = await recoverPlanStage({
        runId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        recoveryLanding: planRecoveryLanding(reviewStep),
        stateStore: store,
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
      });

      expect(outcome).toMatchObject({ ok: false, code: "recovery_requires_git" });
      expect(existsSync(stage)).toBe(true);
      expect(existsSync(sourceReadyIntent)).toBe(true);
      expect(existsSync(durable)).toBe(false);
    });
  });

  test("rejects an uncorrected recovered plan stage without side effects", async () => {
    const worktreePath = planWorktree("recover-plan-stage-uncorrected-");
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const durable = join(worktreePath, "spec", "2026-uncorrected");
    const branch = "recover-plan-stage-uncorrected";
    const stepId = "plan";
    const specPath = "spec/2026-uncorrected";
    const reason = "`## Decisions` bullet is outside the allowed union";

    writeLintCleanPlanStage(stage, "00-first.md");
    const rogueBody = "# Extra\n\n## Decisions\n\n- Out-of-union addition\n";
    writeFileSync(join(stage, "01-second.md"), rogueBody, "utf8");
    writeFileSync(join(stage, "intent.md"), `---\nname: test\n---\n${harnessPlanBlocker(reason)}`, "utf8");
    const { sourceRoot, path: sourceReadyIntent } = seedSourceReadyIntent("recover-plan-stage-uncorrected-source-");

    await withStateStore(async (store) => {
      const runId = seedBlockedPlanDraftRun(store, {
        project: "demo",
        branch,
        worktreePath,
        specPath,
        stepId,
        invocationId: "recover-plan-stage-uncorrected-inv",
        outcomeKind: "contract_miss",
      });
      const logSink = new TestLogSink();
      logSink.append(runId, {
        kind: "contract_miss_detail",
        attemptId: "attempt-1",
        failedContractId: "plan.decisions-shape",
        responseText: "done",
        failureReason: reason,
      });

      const reviewStep = planReviewStep({
        worktreePath,
        stage,
        durable,
        branch,
        invoke: async () => {
          throw new Error("review must not run on an uncorrected recovered plan stage");
        },
        inputs: { sourceRoot, paths: [sourceReadyIntent], consumeFrom: "source" },
      });

      const outcome = await recoverPlanStage({
        runId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        recoveryLanding: planRecoveryLanding(reviewStep),
        stateStore: store,
        logSink,
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
      });

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("unreachable");
      expect(outcome.code).toBe("plan_stage_invalid");
      expect(outcome.message).toContain("01-second.md");
      expect(readFileSync(join(stage, "01-second.md"), "utf8")).toBe(rogueBody);
      expect(existsSync(sourceReadyIntent)).toBe(true);
      expect(existsSync(durable)).toBe(false);

      const writeRun = store.loadRun(runId);
      expect(writeRun?.status).toBe("blocked");
      expect(writeRun?.attempts.length).toBe(1);
    });
  });

  test("retains each invalid recovered plan-stage snapshot before effects", async () => {
    type Scenario = {
      label: string;
      setup: (stage: string) => void;
      reasonContains: string;
    };
    const scenarios: Scenario[] = [
      {
        label: "shape",
        setup: (stage) => {
          mkdirSync(stage, { recursive: true });
          writeFileSync(join(stage, "intent.md"), "---\nname: test\n---\n", "utf8");
        },
        reasonContains: "plan.draft.shape",
      },
      {
        label: "normalizer",
        setup: (stage) => {
          writeLintCleanPlanStage(stage, "00-first.md");
          writeFileSync(
            join(stage, "index.md"),
            "# Index\n\n- [ ] [One](./00-first.md)\n- [ ] [One again](./00-first.md)\n",
            "utf8",
          );
        },
        reasonContains: "more than once",
      },
      {
        label: "staged-markdown",
        setup: (stage) => {
          writeLintCleanPlanStage(stage, "00-first.md");
          const violationBytes = readReviewMdLintFixture(REVIEW_MD_LINT_FIXTURE_IDS.planMd038ViolationSubspec);
          writeFileSync(join(stage, "00-first.md"), violationBytes, "utf8");
        },
        reasonContains: "MD038",
      },
      {
        label: "landing",
        setup: (stage) => {
          writeLintCleanPlanStage(stage, "00-first.md");
          rmSync(join(stage, "intent.md"));
        },
        reasonContains: "invalid shape",
      },
    ];

    for (const scenario of scenarios) {
      const worktreePath = planWorktree(`recover-plan-stage-invalid-${scenario.label}-`);
      const stage = join(worktreePath, ".jarvis-plan-stage");
      const durable = join(worktreePath, "spec", `2026-invalid-${scenario.label}`);
      const branch = `recover-plan-stage-invalid-${scenario.label}`;
      const stepId = "plan";
      const specPath = `spec/2026-invalid-${scenario.label}`;
      scenario.setup(stage);
      const snapshot = readStageFiles(stage);
      const { sourceRoot, path: sourceReadyIntent } = seedSourceReadyIntent(
        `recover-plan-stage-invalid-${scenario.label}-source-`,
      );

      await withStateStore(async (store) => {
        const runId = seedBlockedPlanDraftRun(store, {
          project: "demo",
          branch,
          worktreePath,
          specPath,
          stepId,
          invocationId: `recover-plan-stage-invalid-${scenario.label}-inv`,
          outcomeKind: "contract_miss",
        });

        const reviewStep = planReviewStep({
          worktreePath,
          stage,
          durable,
          branch,
          invoke: async () => {
            throw new Error("review must not run on an invalid recovered plan stage");
          },
          inputs: { sourceRoot, paths: [sourceReadyIntent], consumeFrom: "source" },
        });

        const outcome = await recoverPlanStage({
          runId,
          project: "demo",
          branch,
          worktreePath,
          writeStepId: stepId,
          recoveryLanding: planRecoveryLanding(reviewStep),
          stateStore: store,
          runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
        });

        expect(outcome.ok).toBe(false);
        if (outcome.ok) throw new Error("unreachable");
        expect(outcome.code).toBe("plan_stage_invalid");
        expect(outcome.message).toContain(scenario.reasonContains);
      });

      expect(readStageFiles(stage)).toEqual(snapshot);
      expect(existsSync(sourceReadyIntent)).toBe(true);
      expect(existsSync(durable)).toBe(false);
    }
  });

  test("an invalid-stage refusal names an on-disk file, never one only the agent's deleted draft contained", async () => {
    const worktreePath = planWorktree("recover-plan-stage-named-file-");
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const durable = join(worktreePath, "spec", "2026-named-file");
    const branch = "recover-plan-stage-named-file";
    const stepId = "plan";
    const specPath = "spec/2026-named-file";

    // The agent's original draft included "00-daemon.md"; the operator deleted it and replaced
    // it with "00-fixed.md", which carries a genuine, unrelated lint violation.
    writeLintCleanPlanStage(stage, "00-daemon.md");
    rmSync(join(stage, "00-daemon.md"));
    const violationBytes = readReviewMdLintFixture(REVIEW_MD_LINT_FIXTURE_IDS.planMd038ViolationSubspec);
    writeFileSync(join(stage, "00-fixed.md"), violationBytes, "utf8");
    writeFileSync(join(stage, "index.md"), "# Index\n\n- [ ] [Fixed](./00-fixed.md)\n", "utf8");

    await withStateStore(async (store) => {
      const runId = seedBlockedPlanDraftRun(store, {
        project: "demo",
        branch,
        worktreePath,
        specPath,
        stepId,
        invocationId: "recover-plan-stage-named-file-inv",
        outcomeKind: "contract_miss",
      });

      const reviewStep = planReviewStep({
        worktreePath,
        stage,
        durable,
        branch,
        invoke: async () => {
          throw new Error("review must not run on an invalid recovered plan stage");
        },
      });

      const outcome = await recoverPlanStage({
        runId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        recoveryLanding: planRecoveryLanding(reviewStep),
        stateStore: store,
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
      });

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("unreachable");
      expect(outcome.code).toBe("plan_stage_invalid");
      expect(outcome.message).toContain("00-fixed.md");
      expect(outcome.message).not.toContain("00-daemon.md");
    });
  });

  test("recovers without creating a review run row, logging iteration_started, or dispatching a role", async () => {
    const worktreePath = planWorktree("recover-plan-stage-no-dispatch-");
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const durable = join(worktreePath, "spec", "2026-no-dispatch");
    const branch = "recover-plan-stage-no-dispatch";
    const stepId = "plan";
    const specPath = "spec/2026-no-dispatch";

    writeLintCleanPlanStage(stage, "00-first.md");

    await withStateStore(async (store) => {
      const runId = seedBlockedPlanDraftRun(store, {
        project: "demo",
        branch,
        worktreePath,
        specPath,
        stepId,
        invocationId: "recover-plan-stage-no-dispatch-inv",
        outcomeKind: "contract_miss",
      });
      const logSink = new TestLogSink();
      const runCountBefore = store.listRuns().length;

      const reviewStep = planReviewStep({
        worktreePath,
        stage,
        durable,
        branch,
        // The only externally observable effect of the `executeWorkflow` seam recovery used to
        // go through is dispatching this role and creating its own run row; proving neither
        // happens proves that seam was never called.
        invoke: async () => {
          throw new Error("recovery must not dispatch a review role");
        },
      });

      const outcome = await recoverPlanStage({
        runId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        recoveryLanding: planRecoveryLanding(reviewStep),
        stateStore: store,
        logSink,
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
      });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error("unreachable");
      expect(outcome.kind).toBe("complete");
      expect(store.listRuns().length).toBe(runCountBefore);
      expect(store.findRunByProjectBranch({ project: "demo", branch, stepId: reviewStep.stepId })).toBeNull();
      expect(logSink.getEventsForRun(runId).map((event) => event.kind)).not.toContain("iteration_started");
    });
  });

  test("admits and lands a landing_failed plan write row with a corrected staged tree", async () => {
    const worktreePath = planWorktree("recover-plan-stage-landing-failed-");
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const durable = join(worktreePath, "spec", "2026-landing-failed-recovered");
    const branch = "recover-plan-stage-landing-failed";
    const stepId = "plan";
    const specPath = "spec/2026-landing-failed-recovered";

    writeLintCleanPlanStage(stage, "00-first.md");

    await withStateStore(async (store) => {
      const runId = seedBlockedPlanDraftRun(store, {
        project: "demo",
        branch,
        worktreePath,
        specPath,
        stepId,
        invocationId: "recover-plan-stage-landing-failed-inv",
        outcomeKind: "landing_failed",
      });

      const reviewStep = planReviewStep({
        worktreePath,
        stage,
        durable,
        branch,
        invoke: async () => {
          throw new Error("recovery must not dispatch a review role");
        },
      });

      const outcome = await recoverPlanStage({
        runId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        recoveryLanding: planRecoveryLanding(reviewStep),
        stateStore: store,
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
      });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error("unreachable");
      expect(outcome.kind).toBe("complete");
      expect(existsSync(join(durable, "00-first.md"))).toBe(true);
    });
  });

  test("refuses a landing_failed plan write row with no staged plan tree", async () => {
    const worktreePath = planWorktree("recover-plan-stage-landing-failed-missing-");
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const durable = join(worktreePath, "spec", "2026-landing-failed-missing");
    const branch = "recover-plan-stage-landing-failed-missing";
    const stepId = "plan";
    const specPath = "spec/2026-landing-failed-missing";

    await withStateStore(async (store) => {
      const runId = seedBlockedPlanDraftRun(store, {
        project: "demo",
        branch,
        worktreePath,
        specPath,
        stepId,
        invocationId: "recover-plan-stage-landing-failed-missing-inv",
        outcomeKind: "landing_failed",
      });

      const reviewStep = planReviewStep({
        worktreePath,
        stage,
        durable,
        branch,
        invoke: async () => {
          throw new Error("review must not run on a refused recovery");
        },
      });

      const outcome = await recoverPlanStage({
        runId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        recoveryLanding: planRecoveryLanding(reviewStep),
        stateStore: store,
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
      });

      expect(outcome).toMatchObject({ ok: false, code: "unrelated_plan_stage" });
      expect(existsSync(durable)).toBe(false);
    });
  });

  test("refuses a landing_failed plan write row with an empty staged plan tree", async () => {
    const worktreePath = planWorktree("recover-plan-stage-landing-failed-empty-");
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const durable = join(worktreePath, "spec", "2026-landing-failed-empty");
    const branch = "recover-plan-stage-landing-failed-empty";
    const stepId = "plan";
    const specPath = "spec/2026-landing-failed-empty";

    mkdirSync(stage, { recursive: true });

    await withStateStore(async (store) => {
      const runId = seedBlockedPlanDraftRun(store, {
        project: "demo",
        branch,
        worktreePath,
        specPath,
        stepId,
        invocationId: "recover-plan-stage-landing-failed-empty-inv",
        outcomeKind: "landing_failed",
      });

      const reviewStep = planReviewStep({
        worktreePath,
        stage,
        durable,
        branch,
        invoke: async () => {
          throw new Error("review must not run on a refused recovery");
        },
      });

      const outcome = await recoverPlanStage({
        runId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        recoveryLanding: planRecoveryLanding(reviewStep),
        stateStore: store,
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
      });

      expect(outcome).toMatchObject({ ok: false, code: "unrelated_plan_stage" });
      expect(existsSync(durable)).toBe(false);
    });
  });

  test("admits but does not land a landing_failed plan write row whose staged tree still fails lint", async () => {
    const worktreePath = planWorktree("recover-plan-stage-landing-failed-lint-");
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const durable = join(worktreePath, "spec", "2026-landing-failed-lint");
    const branch = "recover-plan-stage-landing-failed-lint";
    const stepId = "plan";
    const specPath = "spec/2026-landing-failed-lint";

    writeLintCleanPlanStage(stage, "00-first.md");
    writeFileSync(
      join(stage, "00-first.md"),
      readReviewMdLintFixture(REVIEW_MD_LINT_FIXTURE_IDS.planMd038ViolationSubspec),
      "utf8",
    );

    await withStateStore(async (store) => {
      const runId = seedBlockedPlanDraftRun(store, {
        project: "demo",
        branch,
        worktreePath,
        specPath,
        stepId,
        invocationId: "recover-plan-stage-landing-failed-lint-inv",
        outcomeKind: "landing_failed",
      });

      const reviewStep = planReviewStep({
        worktreePath,
        stage,
        durable,
        branch,
        invoke: async () => {
          throw new Error("review must not run on a lint-invalid recovered plan stage");
        },
      });

      const outcome = await recoverPlanStage({
        runId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        recoveryLanding: planRecoveryLanding(reviewStep),
        stateStore: store,
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
      });

      expect(outcome).toMatchObject({ ok: false, code: "plan_stage_invalid" });
      expect(outcome).toMatchObject({ message: expect.stringContaining("MD038") });
      expect(existsSync(durable)).toBe(false);
    });
  });

  test("refuses a landing_failed plan write row whose worktree is held by a live claim", async () => {
    const worktreePath = planWorktree("recover-plan-stage-landing-failed-claim-");
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const durable = join(worktreePath, "spec", "2026-landing-failed-claim");
    const branch = "recover-plan-stage-landing-failed-claim";
    const stepId = "plan";
    const specPath = "spec/2026-landing-failed-claim";

    writeLintCleanPlanStage(stage, "00-first.md");

    await withStateStore(async (store) => {
      const runId = seedBlockedPlanDraftRun(store, {
        project: "demo",
        branch,
        worktreePath,
        specPath,
        stepId,
        invocationId: "recover-plan-stage-landing-failed-claim-inv",
        outcomeKind: "landing_failed",
      });

      // A concurrent `pipeline resume` redraft on the same project/branch holds a live claim on
      // this worktree; recovery must not land underneath it.
      store.createRun({
        project: "demo",
        specRef: "HEAD",
        worktreePath,
        branch,
        specPath: "spec/live",
        stepId: "plan",
        workflowSnapshot: {
          invocationId: "recover-plan-stage-landing-failed-claim-live-inv",
          steps: [{ stepId: "plan", role: "plan", expectedArtifactPath: ".jarvis-plan-stage", agents: ["claude"] }],
        },
        status: "in-progress",
      });

      const reviewStep = planReviewStep({
        worktreePath,
        stage,
        durable,
        branch,
        invoke: async () => {
          throw new Error("review must not run on a refused recovery");
        },
      });

      const outcome = await recoverPlanStage({
        runId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        recoveryLanding: planRecoveryLanding(reviewStep),
        stateStore: store,
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
      });

      expect(outcome).toMatchObject({
        ok: false,
        code: "unrelated_plan_stage",
        message: "a live run holds the worktree claim for this branch",
      });
      expect(existsSync(durable)).toBe(false);
    });
  });
});
