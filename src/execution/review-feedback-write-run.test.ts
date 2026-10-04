import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ReviewFeedbackLaneTarget } from "../persistence/review-feedback-lane-resolution.ts";
import type { StateStore } from "../persistence/state-store.ts";
import { REVIEW_FEEDBACK_RESPONSE_SIDECAR } from "../shared/prompts/review-feedback-write.ts";
import { writeHomeMachineConfig } from "../testing/cli-test-helpers.ts";
import { withStateStore } from "../testing/write-fixtures.ts";
import type { CompletionPublisherInput } from "./completion-publisher.ts";
import { resolvePrReviewInputArtifactPath } from "./pr-review-input-capture.ts";
import { buildReviewFeedbackWorkflowSteps } from "./review-feedback-workflow-steps.ts";
import { externalWorktreeBinding, initGitWorkspace, TestLogSink } from "./workflow-runner.test-support.ts";
import { executeWorkflow, type WriteWorkflowStep } from "./workflow-runner.ts";

const PROJECT = "demo";
const PR_NUMBER = 99;
const ENTRY_INTENT_INVOCATION_ID = "entry-intent-invocation";

function seedIntentLaneEntryRun(
  store: StateStore,
  workspace: string,
  baseRef: string,
  fixture: LaneFixture,
  step: WriteWorkflowStep,
): string {
  const ownedIntent = "lane-owned-intent.md";
  const entryRunId = store.createRun({
    project: PROJECT,
    specRef: baseRef,
    worktreePath: workspace,
    branch: fixture.branchName,
    specPath: fixture.entrySpecPath,
    stepId: "intent",
    status: "completed",
    workflowSnapshot: {
      invocationId: ENTRY_INTENT_INVOCATION_ID,
      steps: [
        {
          stepId: "intent",
          role: "plan",
          stepRules: "",
          expectedArtifactPath: fixture.entrySpecPath,
          agents: [],
          agentModelConfig: {},
        },
      ],
    },
  });
  if (step.reviewFeedbackLane !== undefined) {
    step.reviewFeedbackLane.entryRunId = entryRunId;
  }
  writeFileSync(join(workspace, fixture.entrySpecPath, ownedIntent), "# Owned intent\n", "utf8");
  writeFileSync(
    join(workspace, ".git", "jarvis-intent-output.json"),
    `${JSON.stringify({ [ENTRY_INTENT_INVOCATION_ID]: [ownedIntent] })}\n`,
    "utf8",
  );
  return ownedIntent;
}

type LaneFixture = {
  laneKind: ReviewFeedbackLaneTarget["laneKind"];
  entrySpecPath: string;
  branchName: string;
  seed: (workspace: string, entrySpecPath: string) => void;
};

function laneWorkspace(fixture: LaneFixture): { workspace: string; baseRef: string; step: WriteWorkflowStep } {
  const workspace = initGitWorkspace(`review-feedback-write-${fixture.branchName}-`);
  writeFileSync(join(workspace, "base.txt"), "base\n", "utf8");
  execFileSync("git", ["add", "base.txt"], { cwd: workspace });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: workspace });
  const baseRef = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8" }).trim();
  execFileSync("git", ["checkout", "-b", fixture.branchName], { cwd: workspace });
  fixture.seed(workspace, fixture.entrySpecPath);
  writeFileSync(join(workspace, "lane-tip.txt"), "lane\n", "utf8");
  execFileSync("git", ["add", "lane-tip.txt"], { cwd: workspace });
  execFileSync("git", ["commit", "-qm", "lane tip"], { cwd: workspace });

  const built = buildReviewFeedbackWorkflowSteps({
    target: {
      laneKind: fixture.laneKind,
      project: PROJECT,
      branch: fixture.branchName,
      worktreePath: workspace,
      prNumber: PR_NUMBER,
      prUrl: "https://example.test/pull/99",
      entryRunId: `${fixture.laneKind}-entry`,
      entrySpecPath: fixture.entrySpecPath,
      baseRef,
      provenance: { kind: "bare" },
    },
    projectRoot: workspace,
    configPath: writeHomeMachineConfig(),
  });
  expect(built.ok).toBe(true);
  if (!built.ok) throw new Error(built.error);
  const step = built.steps[0];
  if (step === undefined) throw new Error("expected write step");
  step.worktree = {
    ...step.worktree,
    projectRoot: workspace,
    git: true,
    localPath: workspace,
    baseRef,
  };
  step.withExternalWorktree = externalWorktreeBinding(workspace);
  return { workspace, baseRef, step };
}

function writeReviewArtifact(workspace: string, marker: string): void {
  const artifactPath = resolvePrReviewInputArtifactPath(workspace);
  writeFileSync(
    artifactPath,
    `${JSON.stringify({ captureVersion: 1, prNumber: PR_NUMBER, threads: [{ marker }], topLevelComments: [], reviewBodies: [] }, null, 2)}\n`,
    "utf8",
  );
  execFileSync("git", ["add", artifactPath], { cwd: workspace });
  execFileSync("git", ["commit", "-qm", "review input"], { cwd: workspace });
}

function writeTwoThreadCapture(workspace: string): void {
  const artifactPath = resolvePrReviewInputArtifactPath(workspace);
  writeFileSync(
    artifactPath,
    `${JSON.stringify(
      {
        captureVersion: 1,
        prNumber: PR_NUMBER,
        threads: [
          { threadId: "capture-thread-one", outdated: false, comments: [] },
          { threadId: "capture-thread-two", outdated: false, comments: [] },
        ],
        topLevelComments: [],
        reviewBodies: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  execFileSync("git", ["add", artifactPath], { cwd: workspace });
  execFileSync("git", ["commit", "-qm", "review input two threads"], { cwd: workspace });
}

async function runReviewFeedbackWrite(args: {
  fixture: LaneFixture;
  stdout: string;
  skipResponseSidecar?: boolean;
  onPrompt?: (prompt: string) => void;
  onPublication?: () => void;
}): Promise<{ publication?: CompletionPublisherInput; headBranch: string; prompts: string[] }> {
  const { workspace, baseRef, step } = laneWorkspace(args.fixture);
  writeReviewArtifact(workspace, "capture-marker-unique");
  const prompts: string[] = [];
  let publication: CompletionPublisherInput | undefined;
  step.createBinding = ({ agentId, adapterModel }) => ({
    id: `${agentId}/${adapterModel}`,
    metadata: { agent: agentId, model: adapterModel },
    invoke: async ({ cwd, prompt }) => {
      prompts.push(prompt ?? "");
      args.onPrompt?.(prompt ?? "");
      if (prompt?.includes("Post-completion Shrink")) {
        return { kind: "ok", stdout: "done", stderr: "" } as const;
      }
      // Prompt contract: one response line per captured item, left uncommitted for the harness.
      const response = args.stdout === "no-work" ? "" : "- capture-marker-unique: addressed\n";
      if (args.skipResponseSidecar !== true) {
        writeFileSync(join(cwd, REVIEW_FEEDBACK_RESPONSE_SIDECAR), response, "utf8");
      }
      return { kind: "ok", stdout: args.stdout, stderr: "" } as const;
    },
  });

  await withStateStore(async (store) => {
    let ownedIntentFile: string | undefined;
    if (args.fixture.laneKind === "intent") {
      ownedIntentFile = seedIntentLaneEntryRun(store, workspace, baseRef, args.fixture, step);
    }
    const result = await executeWorkflow({
      steps: [step],
      stateStore: store,
      completionCommitter: async () => ({ commitSha: "publication-commit" }),
      completionPublisher: async (input) => {
        publication = input;
        args.onPublication?.();
        return { prNumber: PR_NUMBER };
      },
      readyFinalizer: async () => {},
    });
    if (args.skipResponseSidecar === true) {
      expect(result.kind).toBe("contract_miss");
      expect(publication).toBeUndefined();
      return;
    }
    expect(result.kind).toBe("complete");
    const headBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: workspace,
      encoding: "utf8",
    }).trim();
    expect(headBranch).toBe(args.fixture.branchName);
    expect(publication?.branch).toBe(args.fixture.branchName);
    expect(publication?.baseRef).toBe(baseRef);
    expect(publication?.specPath).toBe(args.fixture.entrySpecPath);
    if (ownedIntentFile !== undefined) {
      expect(publication?.bodySummary).toContain(`- ${ownedIntentFile}`);
    }
  });

  return { ...(publication !== undefined ? { publication } : {}), headBranch: args.fixture.branchName, prompts };
}

describe("executeWorkflow review-feedback write preset", () => {
  test("intent lane republishes on the lane branch with review input and entry ready-intents path", async () => {
    const { prompts } = await runReviewFeedbackWrite({
      fixture: {
        laneKind: "intent",
        entrySpecPath: "ready-intents",
        branchName: "rf-intent-lane",
        seed: (workspace, entrySpecPath) => {
          mkdirSync(join(workspace, entrySpecPath), { recursive: true });
          writeFileSync(join(workspace, entrySpecPath, "index.md"), "# Intent lane\n", "utf8");
        },
      },
      stdout: "done",
    });
    const rendered = prompts.join("\n");
    expect(rendered).toContain("capture-marker-unique");
    expect(rendered).not.toContain("ACTIVE_SUBSPEC");
  });

  test("plan lane republishes with plan entry spec path", async () => {
    await runReviewFeedbackWrite({
      fixture: {
        laneKind: "plan",
        entrySpecPath: "spec/plan-tree/index.md",
        branchName: "rf-plan-lane",
        seed: (workspace, entrySpecPath) => {
          mkdirSync(dirname(join(workspace, entrySpecPath)), { recursive: true });
          writeFileSync(join(workspace, entrySpecPath), "# Plan\n", "utf8");
        },
      },
      stdout: "done",
    });
  });

  test("implement lane republishes with implement entry spec path", async () => {
    const { prompts } = await runReviewFeedbackWrite({
      fixture: {
        laneKind: "implement",
        entrySpecPath: "spec/implement/index.md",
        branchName: "rf-implement-lane",
        seed: (workspace, entrySpecPath) => {
          mkdirSync(dirname(join(workspace, entrySpecPath)), { recursive: true });
          writeFileSync(join(workspace, entrySpecPath), "# Implement\n\n- [ ] task\n", "utf8");
        },
      },
      stdout: "done",
    });
    expect(prompts.join("\n")).not.toContain("ACTIVE_SUBSPEC");
  });

  for (const stdout of ["done", "no-work"]) {
    test(`${stdout} without the response sidecar fails closed as contract_miss`, async () => {
      await runReviewFeedbackWrite({
        fixture: {
          laneKind: "plan",
          entrySpecPath: "spec/plan-tree/index.md",
          branchName: `rf-missing-response-${stdout}`,
          seed: (workspace, entrySpecPath) => {
            mkdirSync(dirname(join(workspace, entrySpecPath)), { recursive: true });
            writeFileSync(join(workspace, entrySpecPath), "# Plan\n", "utf8");
          },
        },
        stdout,
        skipResponseSidecar: true,
      });
    });
  }

  test("no-work after empty actionable capture still runs completion publication", async () => {
    let publicationCalls = 0;
    await runReviewFeedbackWrite({
      fixture: {
        laneKind: "intent",
        entrySpecPath: "ready-intents",
        branchName: "rf-no-work-lane",
        seed: (workspace, entrySpecPath) => {
          mkdirSync(join(workspace, entrySpecPath), { recursive: true });
          writeFileSync(join(workspace, entrySpecPath, "index.md"), "# Intent lane\n", "utf8");
        },
      },
      stdout: "no-work",
      onPublication: () => {
        publicationCalls += 1;
      },
    });
    expect(publicationCalls).toBe(1);
  });

  test("persists addressed and unaddressed item ids on terminal loop_finished when only one captured item is addressed", async () => {
    const logSink = new TestLogSink();
    const { workspace, step } = laneWorkspace({
      laneKind: "plan",
      entrySpecPath: "spec/plan-tree/index.md",
      branchName: "rf-item-reconcile",
      seed: (ws, entrySpecPath) => {
        mkdirSync(dirname(join(ws, entrySpecPath)), { recursive: true });
        writeFileSync(join(ws, entrySpecPath), "# Plan\n", "utf8");
      },
    });
    writeTwoThreadCapture(workspace);
    step.createBinding = ({ agentId, adapterModel }) => ({
      id: `${agentId}/${adapterModel}`,
      metadata: { agent: agentId, model: adapterModel },
      invoke: async ({ cwd }) => {
        writeFileSync(join(cwd, REVIEW_FEEDBACK_RESPONSE_SIDECAR), "- capture-thread-one: addressed\n", "utf8");
        return { kind: "ok", stdout: "done", stderr: "" } as const;
      },
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        logSink,
        completionCommitter: async () => ({ commitSha: "publication-commit" }),
        completionPublisher: async () => ({ prNumber: PR_NUMBER }),
        readyFinalizer: async () => {},
      });
      expect(result.kind).toBe("complete");
      const terminal = logSink.getEventsForRun(result.runId).findLast((event) => event.kind === "loop_finished");
      expect(terminal?.kind).toBe("loop_finished");
      if (terminal?.kind !== "loop_finished") throw new Error("expected terminal loop_finished");
      expect(terminal.reviewFeedbackAddressedItemIds).toEqual(["capture-thread-one"]);
      expect(terminal.reviewFeedbackUnaddressedItemIds).toEqual(["capture-thread-two"]);
    });
  });
});
