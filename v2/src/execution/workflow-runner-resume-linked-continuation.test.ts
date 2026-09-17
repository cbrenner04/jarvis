import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import { deriveOperatorIncidents } from "../daemon/operator-incidents.ts";
import { resolveWorkflowRunRollup } from "../persistence/workflow-run-status-rollup.ts";
import { withStateStore } from "../testing/write-fixtures.ts";
import { executeWorkflow, type ReviewDebateWorkflowStep, type WriteWorkflowStep } from "./workflow-runner.ts";
import { reconstructLinkedWorkflowResumeSteps } from "./workflow-runner-resume.ts";

const AGENT_MODEL_CONFIG: AgentModelConfig = {
  claude: {
    implement: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
    shrink: { rungs: [{ adapterModel: "S1", priceKey: "P1" }] },
    adversary: { rungs: [{ adapterModel: "ADV", priceKey: "ADV" }] },
    advocate: { rungs: [{ adapterModel: "ADVOC", priceKey: "ADVOC" }] },
    adjudicator: { rungs: [{ adapterModel: "ADJ", priceKey: "ADJ" }] },
    actuator: { rungs: [{ adapterModel: "ACT", priceKey: "ACT" }] },
  },
};

function writeTwoLinkIndexFixture(worktreePath: string): void {
  writeFileSync(join(worktreePath, "index.md"), "- [ ] [One](./one.md)\n- [ ] [Two](./two.md)\n", "utf8");
  writeFileSync(join(worktreePath, "one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] One\n", "utf8");
  writeFileSync(join(worktreePath, "two.md"), "# Two\n\n## Acceptance criteria\n\n- [ ] Two\n", "utf8");
}

/** Ticks the first remaining unchecked criterion across the fixture's two subspecs. Write and shrink
 * invocations alike return "done"; once nothing remains unchecked, no file is touched. */
function tickNextUncheckedCriterion(worktreePath: string): void {
  for (const name of ["one.md", "two.md"]) {
    const path = join(worktreePath, name);
    const content = readFileSync(path, "utf8");
    if (content.includes("- [ ]")) {
      writeFileSync(path, content.replace("- [ ]", "- [x]"), "utf8");
      return;
    }
  }
}

const writeBinding: NonNullable<WriteWorkflowStep["createBinding"]> = ({ agentId, adapterModel }) => ({
  id: `${agentId}/${adapterModel}`,
  metadata: { agent: agentId, model: adapterModel },
  invoke: async ({ cwd }) => {
    tickNextUncheckedCriterion(cwd);
    return { kind: "ok", stdout: "done", stderr: "" } as const;
  },
});

/** Adjudicator approves with an empty verdict, so the debate cycle completes without an actuator run. */
const reviewDebateBinding: NonNullable<ReviewDebateWorkflowStep["createBinding"]> = ({ adapterModel }) => ({
  id: adapterModel,
  metadata: { agent: "claude", model: adapterModel },
  invoke: async () => ({ kind: "ok", stdout: adapterModel === "ADJ" ? "" : "ok", stderr: "" }) as const,
});

describe("resumed linked-implement workflow continuation", () => {
  test("run resume on a failed gate_invocation_refused implement~link-0 row continues through the remaining link, implement~shrink, and implement-review, publishing exactly once", async () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "linked-resume-continuation-"));
    writeTwoLinkIndexFixture(worktreePath);

    await withStateStore(async (store) => {
      const runId = store.createRun({
        project: "demo",
        specRef: "main",
        worktreePath,
        branch: "linked-resume/continuation",
        specPath: "index.md",
        stepId: "implement~link-0",
        workflowSnapshot: {
          invocationId: "linked-resume-continuation",
          steps: [
            {
              stepId: "implement",
              role: "implement",
              stepRules: "implement rules",
              expectedArtifactPath: "index.md",
              agents: ["claude"],
              agentModelConfig: AGENT_MODEL_CONFIG,
            },
            { stepId: "implement-review", role: "", behavior: "review-debate" },
          ],
          reviewPasses: 1,
          reviewBehavior: "debate",
        },
      });
      const attemptId = store.recordAttemptStart(runId);
      store.commitCompletionBoundary({
        attemptId,
        runStatus: "failed",
        outcomeKind: "gate_invocation_refused",
        terminalCause: "gate_invocation_refused",
      });
      store.setRunStatus(runId, "failed");

      const run = store.loadRun(runId);
      if (!run) throw new Error("expected failed linked run");
      const reconstructed = reconstructLinkedWorkflowResumeSteps(run);
      expect(reconstructed.ok).toBe(true);
      if (!reconstructed.ok) return;
      const [writeStep, reviewStep] = reconstructed.steps;
      if (writeStep?.behavior !== "write" || reviewStep?.behavior !== "review-debate") {
        throw new Error("expected [write, review-debate] steps");
      }

      let publishCount = 0;
      const boundWriteStep: WriteWorkflowStep = {
        ...writeStep,
        worktree: { ...writeStep.worktree, git: false, localPath: worktreePath },
        createBinding: writeBinding,
      };
      const boundReviewStep: ReviewDebateWorkflowStep = { ...reviewStep, createBinding: reviewDebateBinding };

      if (!run.workflowSnapshot) throw new Error("expected persisted workflow snapshot");
      const result = await executeWorkflow({
        steps: [boundWriteStep, boundReviewStep],
        stateStore: store,
        workflowSnapshot: run.workflowSnapshot,
        completionCommitter: async () => ({ commitSha: "sha-1" }),
        completionPublisher: async () => {
          publishCount += 1;
          return { prNumber: 1, prUrl: "https://example.invalid/pr/1" };
        },
        readyFinalizer: async () => {},
      });

      expect(result.kind).toBe("complete");
      expect(publishCount).toBe(1);

      const link0 = store.findRunByProjectBranch({
        project: "demo",
        branch: "linked-resume/continuation",
        stepId: "implement~link-0",
      });
      const link1 = store.findRunByProjectBranch({
        project: "demo",
        branch: "linked-resume/continuation",
        stepId: "implement~link-1",
      });
      const shrink = store.findRunByProjectBranch({
        project: "demo",
        branch: "linked-resume/continuation",
        stepId: "implement~shrink",
      });
      const review = store.findRunByProjectBranch({
        project: "demo",
        branch: "linked-resume/continuation",
        stepId: "implement-review",
      });
      expect(link0?.status).toBe("completed");
      expect(link1?.status).toBe("completed");
      expect(shrink?.status).toBe("completed");
      expect(review?.status).toBe("completed");
      expect(readFileSync(join(worktreePath, "index.md"), "utf8")).toContain("[x] [One]");
      expect(readFileSync(join(worktreePath, "index.md"), "utf8")).toContain("[x] [Two]");

      const siblingRuns = store.findRunsByInvocationId("linked-resume-continuation");
      const rollup = resolveWorkflowRunRollup({
        entryRun: run,
        workflowSnapshot: run.workflowSnapshot,
        siblingRuns,
        isLive: false,
      });
      expect(rollup.status).toBe("completed");

      const incidents = deriveOperatorIncidents(store);
      const entryIncident = incidents.find((incident) => incident.runId === runId);
      expect(entryIncident).toMatchObject({ kind: "run-ad-hoc-terminal", cause: "completed" });
    });

    rmSync(worktreePath, { recursive: true, force: true });
  });

  test("run resume on a failed gate_invocation_refused implement~link-1 row (the last link) runs implement~shrink and implement-review and publishes exactly once; the link row itself never publishes", async () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "linked-resume-last-link-"));
    writeFileSync(join(worktreePath, "index.md"), "- [x] [One](./one.md)\n- [ ] [Two](./two.md)\n", "utf8");
    writeFileSync(join(worktreePath, "one.md"), "# One\n\n## Acceptance criteria\n\n- [x] One\n", "utf8");
    writeFileSync(join(worktreePath, "two.md"), "# Two\n\n## Acceptance criteria\n\n- [ ] Two\n", "utf8");

    await withStateStore(async (store) => {
      const runId = store.createRun({
        project: "demo",
        specRef: "main",
        worktreePath,
        branch: "linked-resume/last-link",
        specPath: "index.md",
        stepId: "implement~link-1",
        workflowSnapshot: {
          invocationId: "linked-resume-last-link",
          steps: [
            {
              stepId: "implement",
              role: "implement",
              stepRules: "implement rules",
              expectedArtifactPath: "index.md",
              agents: ["claude"],
              agentModelConfig: AGENT_MODEL_CONFIG,
            },
            { stepId: "implement-review", role: "", behavior: "review-debate" },
          ],
          reviewPasses: 1,
          reviewBehavior: "debate",
        },
      });
      const attemptId = store.recordAttemptStart(runId);
      store.commitCompletionBoundary({
        attemptId,
        runStatus: "failed",
        outcomeKind: "gate_invocation_refused",
        terminalCause: "gate_invocation_refused",
      });
      store.setRunStatus(runId, "failed");

      const run = store.loadRun(runId);
      if (!run) throw new Error("expected failed linked run");
      const reconstructed = reconstructLinkedWorkflowResumeSteps(run);
      expect(reconstructed.ok).toBe(true);
      if (!reconstructed.ok) return;
      const [writeStep, reviewStep] = reconstructed.steps;
      if (writeStep?.behavior !== "write" || reviewStep?.behavior !== "review-debate") {
        throw new Error("expected [write, review-debate] steps");
      }

      let publishCount = 0;
      const boundWriteStep: WriteWorkflowStep = {
        ...writeStep,
        worktree: { ...writeStep.worktree, git: false, localPath: worktreePath },
        createBinding: writeBinding,
      };
      const boundReviewStep: ReviewDebateWorkflowStep = { ...reviewStep, createBinding: reviewDebateBinding };

      if (!run.workflowSnapshot) throw new Error("expected persisted workflow snapshot");
      const result = await executeWorkflow({
        steps: [boundWriteStep, boundReviewStep],
        stateStore: store,
        workflowSnapshot: run.workflowSnapshot,
        completionCommitter: async () => ({ commitSha: "sha-1" }),
        completionPublisher: async () => {
          publishCount += 1;
          return { prNumber: 2, prUrl: "https://example.invalid/pr/2" };
        },
        readyFinalizer: async () => {},
      });

      expect(result.kind).toBe("complete");
      expect(publishCount).toBe(1);

      const link1 = store.findRunByProjectBranch({
        project: "demo",
        branch: "linked-resume/last-link",
        stepId: "implement~link-1",
      });
      const shrink = store.findRunByProjectBranch({
        project: "demo",
        branch: "linked-resume/last-link",
        stepId: "implement~shrink",
      });
      const review = store.findRunByProjectBranch({
        project: "demo",
        branch: "linked-resume/last-link",
        stepId: "implement-review",
      });
      expect(link1?.status).toBe("completed");
      expect(shrink?.status).toBe("completed");
      expect(review?.status).toBe("completed");
      // Publication lands on the workflow tail (the review row), never on the link row it resumed.
      expect(link1?.prNumber ?? undefined).toBeUndefined();
      expect(review?.prNumber).toBe(2);
      expect(readFileSync(join(worktreePath, "index.md"), "utf8")).toContain("[x] [Two]");
    });

    rmSync(worktreePath, { recursive: true, force: true });
  });
});
