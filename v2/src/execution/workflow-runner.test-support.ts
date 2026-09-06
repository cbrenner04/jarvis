import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  InvocationBinding,
  InvocationCompletedRecord,
  InvocationResult,
} from "../../../shared/invocation/execute.ts";
import { resolveHarnessRoot } from "../../../shared/markdownlint-repair.ts";
import { implementReviewPromptProfile } from "../../../shared/prompts/review-implement.ts";
import { StructuralTestLocatorError } from "../../../shared/structural-test-locator.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import type { WriteLoopBindingSourceDeps } from "../daemon/daemon.ts";
import type { LogEvent, LogSink, PersistedRecord } from "../persistence/log-stream.ts";
import type { openStateStore } from "../persistence/state-store.ts";
import { createFakeWithExternalWorktree, createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
import type { ExternalWorktree, WithExternalWorktreeResult } from "./external-worktree.ts";
import type { WorkBoundaryRecordedRecord } from "./work-boundary-telemetry.ts";
import type {
  ReviewDebateWorkflowStep,
  ReviewWorkflowStep,
  WorkflowStepInput,
  WriteWorkflowStep,
} from "./workflow-runner.ts";

export const { roots } = trackedTempRoots();

/** Test log sink that captures all events. */
export class TestLogSink implements LogSink {
  events: Array<{ runId: string; event: LogEvent }> = [];

  append(runId: string, event: LogEvent): void {
    this.events.push({ runId, event });
  }

  close(): void {
    // no-op
  }

  getEventsForRun(runId: string): LogEvent[] {
    return this.events.filter((e) => e.runId === runId).map((e) => e.event);
  }

  /** `LogReader`-shaped read of this run's events, so `priorLogRecordsFromSink` sees them. */
  tail(runId: string): PersistedRecord[] {
    return this.events
      .filter((e) => e.runId === runId)
      .map((e, index) => ({ runId, seq: index, ts: new Date().toISOString(), event: e.event }));
  }
}

export const DEFAULT_AGENT_MODEL_CONFIG = {
  claude: {
    implement: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
    shrink: { rungs: [{ adapterModel: "S1", priceKey: "S1" }] },
  },
};

export function workflowRunnerResumeProfileDeps(): WriteLoopBindingSourceDeps {
  const profileHome = mkdtempSync(join(tmpdir(), "jarvis-workflow-runner-profile-"));
  const machinesDir = join(profileHome, "machines");
  const profileName = "workflow-runner-profile";
  mkdirSync(machinesDir, { recursive: true });
  const rung = (adapterModel: string, priceKey: string) => ({ rungs: [{ adapterModel, priceKey }] });
  const claudeRoles = {
    plan: rung("plan", "plan"),
    implement: rung("M1", "P1"),
    shrink: rung("S1", "S1"),
    adversary: rung("adv", "adv"),
    critic: rung("crit", "crit"),
    advocate: rung("advoc", "advoc"),
    adjudicator: rung("adj", "adj"),
    actuator: rung("act", "act"),
  };
  writeFileSync(join(machinesDir, `${profileName}.json`), JSON.stringify({ models: { claude: claudeRoles } }));
  writeFileSync(join(profileHome, "config.json"), JSON.stringify({ machineProfile: profileName, agents: ["claude"] }));
  return {
    machineConfigPath: join(profileHome, "config.json"),
    machinesDir,
  };
}

export const TWO_AGENTS = ["claude", "codex"] as const;

export const VALID_TWO_AGENT_CONFIG: AgentModelConfig = {
  claude: {
    implement: { rungs: [{ adapterModel: "claude-implement", priceKey: "claude-implement" }] },
    shrink: { rungs: [{ adapterModel: "claude-shrink", priceKey: "claude-shrink" }] },
  },
  codex: {
    implement: { rungs: [{ adapterModel: "codex-implement", priceKey: "codex-implement" }] },
    shrink: { rungs: [{ adapterModel: "codex-shrink", priceKey: "codex-shrink" }] },
  },
};

export const MISSING_CODEX_IMPLEMENT_CONFIG: AgentModelConfig = {
  claude: {
    implement: { rungs: [{ adapterModel: "claude-implement", priceKey: "claude-implement" }] },
    shrink: { rungs: [{ adapterModel: "claude-shrink", priceKey: "claude-shrink" }] },
  },
  codex: {},
};

export const NO_STEP_ROLES_CONFIG: AgentModelConfig = {
  claude: {},
  codex: {},
};

export function createBindingFactory(
  invoke: (binding: { agentId: string; adapterModel: string; cwd: string }) => Promise<InvocationResult>,
  onResolve?: (binding: { agentId: string; adapterModel: string }) => void,
): NonNullable<WriteWorkflowStep["createBinding"]> {
  return ({ agentId, adapterModel }: { agentId: string; adapterModel: string }) => {
    onResolve?.({ agentId, adapterModel });
    return {
      id: `${agentId}/${adapterModel}`,
      invoke: ({ cwd }: Parameters<InvocationBinding["invoke"]>[0]) => invoke({ agentId, adapterModel, cwd }),
      metadata: { agent: agentId, model: adapterModel },
    } satisfies InvocationBinding;
  };
}

export const doneBindingFactory = createBindingFactory(async ({ cwd }) => {
  writeFileSync(`${cwd}/proof.txt`, "ok\n", "utf8");
  return { kind: "ok", stdout: "done", stderr: "" } as const;
});

export function okTokenBindingFactory(stdout: string) {
  return createBindingFactory(async ({ cwd }) => {
    if (stdout === "blocked") {
      const specPath = join(cwd, "spec.md");
      if (existsSync(specPath)) {
        appendFileSync(specPath, "\n## Blocker\n\nblocked\n", "utf8");
      }
    }
    return { kind: "ok", stdout, stderr: "" } as const;
  });
}

export const errorBindingFactory = createBindingFactory(
  async () => ({ kind: "error", exitCode: 1, stderr: "error" }) as const,
);

export function initGitWorkspace(prefix: string) {
  const workspace = mkdtempSync(join(tmpdir(), prefix));
  execFileSync("git", ["init", "-q"], { cwd: workspace });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: workspace });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: workspace });
  return workspace;
}

export function externalWorktreeBinding(
  workspace: string,
): <T>(
  _args: { branchName: string; projectName: string },
  run: (worktree: ExternalWorktree) => Promise<T> | T,
) => Promise<WithExternalWorktreeResult<T>> {
  return async <T>(
    _args: { branchName: string; projectName: string },
    run: (worktree: ExternalWorktree) => Promise<T> | T,
  ): Promise<WithExternalWorktreeResult<T>> => ({
    worktree: { path: workspace, reused: false },
    lock: { kind: "acquired" },
    value: await run({ path: workspace, reused: false }),
  });
}

export function createIntentWorktreeHarness(branchName: string) {
  const workspace = initGitWorkspace(`intent-workflow-${branchName}-`);
  writeFileSync(join(workspace, "base.txt"), "base\n", "utf8");
  execFileSync("git", ["add", "."], { cwd: workspace });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: workspace });
  return {
    workspace,
    withExternalWorktree: externalWorktreeBinding(workspace),
  };
}

// Path is allocated but not materialized: the directory (and its git repo) is created lazily on
// the first `withExternalWorktree` call, mirroring a non-index implement step whose worktree
// doesn't pre-exist when the workflow starts.
export function createLazyIntentWorktreeHarness(branchName: string) {
  const workspace = mkdtempSync(join(tmpdir(), `lazy-workflow-${branchName}-`));
  rmSync(workspace, { recursive: true, force: true });
  let materialized = false;
  const withExternalWorktree = async <T>(
    _args: { branchName: string; projectName: string },
    run: (worktree: ExternalWorktree) => Promise<T> | T,
  ): Promise<WithExternalWorktreeResult<T>> => {
    if (!materialized) {
      mkdirSync(workspace, { recursive: true });
      execFileSync("git", ["init", "-q"], { cwd: workspace });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: workspace });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: workspace });
      writeFileSync(join(workspace, "base.txt"), "base\n", "utf8");
      execFileSync("git", ["add", "."], { cwd: workspace });
      execFileSync("git", ["commit", "-qm", "base"], { cwd: workspace });
      // Named so callers can use a fixed baseRef ("lazy-base") that survives later commits,
      // instead of the literal "HEAD" sentinel, which would self-diff empty once this branch's
      // own commits move HEAD past it.
      execFileSync("git", ["tag", "lazy-base"], { cwd: workspace });
      materialized = true;
    }
    return {
      worktree: { path: workspace, reused: materialized },
      lock: { kind: "acquired" },
      value: await run({ path: workspace, reused: true }),
    };
  };
  return { workspace, withExternalWorktree };
}

export const IMPLEMENT_BODY_SPEC_PATH = "spec/2026-01-01-implement-body";

export function createImplementBodySummaryStep(branchName: string) {
  const workspace = initGitWorkspace(`implement-body-summary-${branchName}-`);
  const specDir = join(workspace, IMPLEMENT_BODY_SPEC_PATH);
  mkdirSync(specDir, { recursive: true });
  writeFileSync(join(specDir, "index.md"), "# Implement body\n\n- [ ] [00 - First](./00-first.md)\n", "utf8");
  writeFileSync(join(specDir, "00-first.md"), "# First\n\nImplement the feature.\n", "utf8");
  execFileSync("git", ["add", "."], { cwd: workspace });
  execFileSync("git", ["commit", "-qm", "base spec"], { cwd: workspace });
  const baseRef = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8" }).trim();

  mkdirSync(join(workspace, "v2", "src"), { recursive: true });
  writeFileSync(join(workspace, "v2", "src", "feature.ts"), "export const feature = 1;\n", "utf8");
  execFileSync("git", ["add", "."], { cwd: workspace });
  execFileSync("git", ["commit", "-qm", "add feature"], { cwd: workspace });

  const step = createStep({
    stepId: "implement",
    role: "implement",
    promptId: "patch.prompt.body",
    branchName,
    specPath: IMPLEMENT_BODY_SPEC_PATH,
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
  return { step, workspace };
}

export function createShrinkTestStep(
  branchName: string,
  invoke: (args: { cwd: string; shrink: boolean }) => Promise<InvocationResult>,
) {
  const harness = createIntentWorktreeHarness(branchName);
  // A fixed base sha, not the literal "HEAD" sentinel: the completion tail's content-vs-base
  // gate diffs the completion commit against this ref after it has already moved HEAD forward,
  // so a self-tracking "HEAD" would always self-diff empty regardless of real content.
  const baseRef = execFileSync("git", ["rev-parse", "HEAD"], { cwd: harness.workspace, encoding: "utf8" }).trim();
  const step = createStep({
    stepId: "implement",
    role: "implement",
    branchName,
    createBinding: ({ agentId, adapterModel }) => ({
      id: `${agentId}/${adapterModel}`,
      invoke: ({ cwd, prompt }) => invoke({ cwd, shrink: prompt.includes("Post-completion Shrink") }),
      metadata: { agent: agentId, model: adapterModel },
    }),
  });
  step.worktree = {
    projectRoot: harness.workspace,
    projectName: "demo",
    branchName,
    baseRef,
    git: false,
    localPath: harness.workspace,
  };
  step.withExternalWorktree = harness.withExternalWorktree;
  return { harness, step };
}

export function seedLandedIntentFiles(workspace: string, invocationId: string, files: readonly string[]): void {
  const durableDir = join(workspace, "ready-intents");
  mkdirSync(durableDir, { recursive: true });
  for (const name of files) {
    writeFileSync(
      join(durableDir, name),
      `---\nname: ${name.replace(/\.md$/, "")}\n---\n\n# ${name}\n\n## Prerequisites\n`,
      "utf8",
    );
  }
  mkdirSync(join(workspace, ".git"), { recursive: true });
  writeFileSync(
    join(workspace, ".git", "jarvis-intent-output.json"),
    `${JSON.stringify({ [invocationId]: [...files] })}\n`,
    "utf8",
  );
}

export function seedCompletedWriteRun(
  store: ReturnType<typeof openStateStore>,
  step: WriteWorkflowStep,
  workspace: string,
  invocationId: string,
): string {
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
      ...(step.creationTitle !== undefined ? { creationTitle: step.creationTitle } : {}),
    },
  });
  const attemptId = store.recordAttemptStart(runId);
  store.commitCompletionBoundary({
    attemptId,
    runStatus: "completed",
    outcomeKind: "done",
    completionAgent: "claude",
  });
  return runId;
}

export function createStep(
  overrides: Partial<Omit<WriteWorkflowStep, "worktree" | "behavior">> & {
    stepId: string;
    role: string;
    branchName?: string;
  },
): WriteWorkflowStep {
  const home = createJarvisHome();
  roots.push(home.jarvisRoot);
  const { branchName, ...rest } = overrides;
  return {
    behavior: "write",
    worktree: {
      projectRoot: "/fake",
      projectName: "demo",
      branchName: branchName ?? "workflow-run",
      baseRef: "HEAD",
      jarvisRoot: home.jarvisRoot,
    },
    specPath: "spec.md",
    stepRules: "Return exactly one terminal token.",
    expectedArtifactPath: "proof.txt",
    agents: ["claude"],
    agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
    createBinding: doneBindingFactory,
    withExternalWorktree: createFakeWithExternalWorktree(home.jarvisRoot),
    ...rest,
  };
}

export function createStepInput(
  overrides: Partial<Omit<WriteWorkflowStep, "worktree" | "behavior">> & {
    stepId: string;
    role: string;
    branchName?: string;
  },
): WorkflowStepInput {
  return createStep(overrides);
}

export const DEBATE_AGENT_MODEL_CONFIG: AgentModelConfig = {
  claude: {
    adversary: { rungs: [{ adapterModel: "ADV", priceKey: "p-adv" }] },
    advocate: { rungs: [{ adapterModel: "ADVOC", priceKey: "p-advoc" }] },
    adjudicator: { rungs: [{ adapterModel: "ADJ", priceKey: "p-adj" }] },
    actuator: { rungs: [{ adapterModel: "ACT", priceKey: "p-act" }] },
  },
};

export function createDebateBindingFactory(
  invoke: (binding: { agentId: string; adapterModel: string }) => Promise<InvocationResult>,
  onResolve?: (binding: { agentId: string; adapterModel: string }) => void,
): NonNullable<ReviewDebateWorkflowStep["createBinding"]> {
  return ({ agentId, adapterModel }: { agentId: string; adapterModel: string }) => {
    onResolve?.({ agentId, adapterModel });
    return {
      id: `${agentId}/${adapterModel}`,
      invoke: () => invoke({ agentId, adapterModel }),
      metadata: { agent: agentId, model: adapterModel },
    } satisfies InvocationBinding;
  };
}

export function createReviewDebateActuatorFailureBindingFactory(
  actuatorFailure: "timeout" | "stall",
): NonNullable<ReviewDebateWorkflowStep["createBinding"]> {
  return ({ agentId, adapterModel }: { agentId: string; adapterModel: string }) => ({
    id: `${agentId}/${adapterModel}`,
    metadata: { agent: agentId, model: adapterModel },
    invoke: ({ signal }) => {
      if (adapterModel !== "ACT") {
        return Promise.resolve(
          adapterModel === "ADJ"
            ? ({ kind: "ok", stdout: "apply this fix", stderr: "" } as const)
            : ({ kind: "ok", stdout: "ok", stderr: "" } as const),
        );
      }
      if (actuatorFailure === "stall") {
        return Promise.resolve({ kind: "stall", stderr: "no output" } as const);
      }
      return new Promise<InvocationResult>((resolve) => {
        signal?.addEventListener("abort", () => resolve({ kind: "error", exitCode: 1, stderr: "aborted" }), {
          once: true,
        });
      });
    },
  });
}

export function debateVerdictPath(): string {
  return join(mkdtempSync(join(tmpdir(), "workflow-review-debate-")), "verdict.md");
}

export function createDebateStep(
  overrides: Partial<Omit<ReviewDebateWorkflowStep, "behavior">> & { stepId: string; verdictPath: string },
): ReviewDebateWorkflowStep {
  return {
    behavior: "review-debate",
    cwd: "/fake",
    project: "demo",
    branch: "review-debate-workflow",
    prompts: { adversary: "find issues", advocate: "argue merits", adjudicator: "settle it" },
    maxCycles: 1,
    agents: { adversary: ["claude"], advocate: ["claude"], adjudicator: ["claude"], actuator: ["claude"] },
    agentModelConfig: DEBATE_AGENT_MODEL_CONFIG,
    profile: implementReviewPromptProfile,
    profileContext: { specPath: "index.md", cwd: "/fake", baseBranch: "HEAD", passNumber: 1, totalPasses: 1 },
    ...overrides,
  };
}

export const REVIEW_MD_LINT_FIXTURES = join(import.meta.dir, "fixtures", "write-loop-staged-markdown-lint");

export const REVIEW_MD_LINT_FIXTURE_IDS = {
  planMd012CleanSubspec: "plan-md012-clean-subspec.md",
  planMd012ViolationSubspec: "plan-md012-violation-subspec.md",
  planMd038CleanSubspec: "plan-md038-clean-subspec.md",
  planMd038ViolationSubspec: "plan-md038-violation-subspec.md",
  intentMd038Clean: "intent-md038-clean.md",
  intentMd038Violation: "intent-md038-violation.md",
  intentLandingAndMd038Violation: "intent-landing-and-md038-violation.md",
} as const;

export function readReviewMdLintFixture(fixtureId: string): string {
  try {
    return readFileSync(join(REVIEW_MD_LINT_FIXTURES, fixtureId), "utf8");
  } catch {
    throw new StructuralTestLocatorError("discovered-file", fixtureId);
  }
}

export const LINT_CLEAN_INTENT_EXAMPLE_MD = readReviewMdLintFixture(REVIEW_MD_LINT_FIXTURE_IDS.intentMd038Clean);

export const REVIEW_MD_LINT_HARNESS_ROOT = resolveHarnessRoot(join(import.meta.dir, "..", "..", ".."));

export function hasHarnessMarkdownlintForReview(): boolean {
  if (REVIEW_MD_LINT_HARNESS_ROOT === null) return false;
  return existsSync(join(REVIEW_MD_LINT_HARNESS_ROOT, "node_modules", "markdownlint-cli2", "markdownlint-cli2.js"));
}

export function skipReviewWithoutHarnessMarkdownlint(reason: string): boolean {
  if (hasHarnessMarkdownlintForReview()) return false;
  process.stderr.write(`skip: ${reason}; pinned markdownlint binary not installed in this worktree\n`);
  return true;
}

export function writeLintCleanPlanStage(
  stage: string,
  subspecFile = "00-one.md",
  subspecBody = readReviewMdLintFixture(REVIEW_MD_LINT_FIXTURE_IDS.planMd012CleanSubspec),
): void {
  mkdirSync(stage, { recursive: true });
  writeFileSync(join(stage, "intent.md"), "---\nname: test\n---\n", "utf8");
  writeFileSync(join(stage, "index.md"), `# Index\n\n- [ ] [One](./${subspecFile})\n`, "utf8");
  writeFileSync(join(stage, subspecFile), subspecBody, "utf8");
}

export function writeLintCleanIntentStageFile(stage: string, fileName = "existing.md"): void {
  mkdirSync(stage, { recursive: true });
  writeFileSync(join(stage, fileName), LINT_CLEAN_INTENT_EXAMPLE_MD, "utf8");
}

export function loadTelemetryRows(path: string): InvocationCompletedRecord[] {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as InvocationCompletedRecord);
}

export function loadWorkBoundaryRows(path: string): WorkBoundaryRecordedRecord[] {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as WorkBoundaryRecordedRecord)
    .filter((row) => row.record_kind === "work_boundary_recorded");
}

export const config: AgentModelConfig = {
  claude: {
    critic: { rungs: [{ adapterModel: "critic", priceKey: "critic" }] },
    plan: { rungs: [{ adapterModel: "plan", priceKey: "plan" }] },
  },
  codex: { actuator: { rungs: [{ adapterModel: "actuator", priceKey: "actuator" }] } },
};

export function stageReviewedIntent(workspace: string): void {
  writeLintCleanIntentStageFile(join(workspace, ".jarvis-intent-stage"));
}

export function seedFailedIntentReviewResumeRun(
  store: ReturnType<typeof openStateStore>,
  workspace: string,
  options: {
    branch: string;
    invocationId: string;
    intentAgents?: readonly string[];
    intentStepConfig?: { fixCommand?: string; readyCommand?: string };
  },
): string {
  const base = {
    project: "demo",
    specRef: "main",
    worktreePath: workspace,
    branch: options.branch,
    workflowSnapshot: {
      invocationId: options.invocationId,
      creationTitle: `intent: ${options.branch}`,
      steps: [
        {
          stepId: "intent",
          role: "plan",
          durable: true,
          expectedArtifactPath: ".jarvis-intent-stage",
          agents: options.intentAgents ?? ["claude"],
          ...(options.intentStepConfig?.fixCommand !== undefined
            ? { fixCommand: options.intentStepConfig.fixCommand }
            : {}),
          ...(options.intentStepConfig?.readyCommand !== undefined
            ? { readyCommand: options.intentStepConfig.readyCommand }
            : {}),
        },
        { stepId: "review", role: "", durable: true, behavior: "review" as const },
      ],
    },
  };
  store.createRun({ ...base, specPath: "ready-intents", stepId: "intent" });
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

export function reviewedIntentStep(workspace: string, overrides: Partial<ReviewWorkflowStep> = {}): ReviewWorkflowStep {
  return {
    behavior: "review",
    stepId: "review",
    project: "demo",
    branch: "intent/review",
    cwd: workspace,
    prompt: "inspect",
    verdictPath: join(workspace, ".jarvis-intent-review-verdict.md"),
    maxCycles: 1,
    agents: { critic: ["claude"], actuator: ["codex"] },
    agentModelConfig: config,
    landing: {
      kind: "intent-stage",
      output: { durableDir: "ready-intents" },
      stagingDir: ".jarvis-intent-stage",
      invocationId: "invocation-1",
      baseRef: "none",
    },
    ...overrides,
  };
}

export function createPatchReviewDebateStep(args: {
  branchName: string;
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

export function createTrackedReviewDebateBindingFactory(
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
