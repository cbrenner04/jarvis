import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withStateStore } from "../testing/write-fixtures.ts";
import { DEFAULT_AGENT_MODEL_CONFIG } from "./workflow-runner.test-support.ts";
import { reconstructLinkedWorkflowResumeSteps } from "./workflow-runner-resume.ts";

function writeTwoLinkIndexFixture(worktreePath: string): void {
  writeFileSync(join(worktreePath, "index.md"), "- [ ] [One](./one.md)\n- [ ] [Two](./two.md)\n", "utf8");
  writeFileSync(join(worktreePath, "one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] One\n", "utf8");
  writeFileSync(join(worktreePath, "two.md"), "# Two\n\n## Acceptance criteria\n\n- [ ] Two\n", "utf8");
}

describe("reconstructLinkedWorkflowResumeSteps", () => {
  test("rebuilds the outer implement step plus a review-debate step from a failed link-0 row", async () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "linked-workflow-resume-debate-"));
    writeTwoLinkIndexFixture(worktreePath);

    await withStateStore(async (store) => {
      const runId = store.createRun({
        project: "demo",
        specRef: "main",
        worktreePath,
        branch: "linked-resume/debate",
        specPath: "index.md",
        stepId: "implement~link-0",
        workflowSnapshot: {
          invocationId: "linked-resume-debate",
          steps: [
            {
              stepId: "implement",
              role: "implement",
              stepRules: "implement rules",
              expectedArtifactPath: "index.md",
              agents: ["claude"],
              agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
            },
            { stepId: "implement-review", role: "", behavior: "review-debate" },
          ],
          reviewPasses: 2,
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
      expect(reconstructed.steps).toHaveLength(2);
      const [writeStep, reviewStep] = reconstructed.steps;
      expect(writeStep).toMatchObject({
        behavior: "write",
        stepId: "implement",
        role: "implement",
        linkedIndexRouting: true,
        expectedArtifactPath: "index.md",
        agents: ["claude"],
        worktree: {
          projectRoot: worktreePath,
          projectName: "demo",
          branchName: "linked-resume/debate",
          baseRef: "main",
        },
      });
      expect(reviewStep).toMatchObject({
        behavior: "review-debate",
        stepId: "implement-review",
        project: "demo",
        branch: "linked-resume/debate",
        cwd: worktreePath,
        maxCycles: 2,
      });
      if (reviewStep?.behavior === "review-debate") {
        expect(reviewStep.agents).toEqual({
          adversary: ["claude"],
          advocate: ["claude"],
          adjudicator: ["claude"],
          actuator: ["claude"],
        });
        expect(reviewStep.agentModelConfig).toEqual(DEFAULT_AGENT_MODEL_CONFIG);
        expect(reviewStep.verdictPath).toContain(worktreePath);
      }
    });

    rmSync(worktreePath, { recursive: true, force: true });
  });

  test("rebuilds a light review step when the snapshot recorded reviewBehavior light", async () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "linked-workflow-resume-light-"));
    writeTwoLinkIndexFixture(worktreePath);

    await withStateStore(async (store) => {
      const runId = store.createRun({
        project: "demo",
        specRef: "main",
        worktreePath,
        branch: "linked-resume/light",
        specPath: "index.md",
        stepId: "implement~link-1",
        workflowSnapshot: {
          invocationId: "linked-resume-light",
          steps: [
            {
              stepId: "implement",
              role: "implement",
              stepRules: "implement rules",
              expectedArtifactPath: "index.md",
              agents: ["claude"],
              agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
            },
            { stepId: "implement-review", role: "", behavior: "review" },
          ],
          reviewPasses: 1,
          reviewBehavior: "light",
        },
      });
      store.setRunStatus(runId, "paused");

      const run = store.loadRun(runId);
      if (!run) throw new Error("expected paused linked run");
      const reconstructed = reconstructLinkedWorkflowResumeSteps(run);
      expect(reconstructed.ok).toBe(true);
      if (!reconstructed.ok) return;
      const reviewStep = reconstructed.steps[1];
      expect(reviewStep).toMatchObject({ behavior: "review", stepId: "implement-review", maxCycles: 1 });
      if (reviewStep?.behavior === "review") {
        expect(reviewStep.agents).toEqual({ critic: ["claude"], actuator: ["claude"] });
      }
    });

    rmSync(worktreePath, { recursive: true, force: true });
  });

  test("omits the review step when the workflow has no review/review-debate step in its snapshot", async () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "linked-workflow-resume-no-review-"));
    writeTwoLinkIndexFixture(worktreePath);

    await withStateStore(async (store) => {
      const runId = store.createRun({
        project: "demo",
        specRef: "main",
        worktreePath,
        branch: "linked-resume/no-review",
        specPath: "index.md",
        stepId: "implement~link-0",
        workflowSnapshot: {
          invocationId: "linked-resume-no-review",
          steps: [
            {
              stepId: "implement",
              role: "implement",
              stepRules: "implement rules",
              expectedArtifactPath: "index.md",
              agents: ["claude"],
              agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
            },
          ],
        },
      });
      store.setRunStatus(runId, "paused");

      const run = store.loadRun(runId);
      if (!run) throw new Error("expected paused linked run");
      const reconstructed = reconstructLinkedWorkflowResumeSteps(run);
      expect(reconstructed.ok).toBe(true);
      if (!reconstructed.ok) return;
      expect(reconstructed.steps).toHaveLength(1);
    });

    rmSync(worktreePath, { recursive: true, force: true });
  });

  test("refuses with the same reason a malformed pinned link index gives reconstructPausedWriteResumeInput", async () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "linked-workflow-resume-malformed-"));
    // Only one linked entry (index 0) on disk, but the row pins link index 1.
    writeFileSync(join(worktreePath, "index.md"), "- [ ] [One](./one.md)\n", "utf8");
    writeFileSync(join(worktreePath, "one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] One\n", "utf8");

    await withStateStore(async (store) => {
      const runId = store.createRun({
        project: "demo",
        specRef: "main",
        worktreePath,
        branch: "linked-resume/malformed",
        specPath: "index.md",
        stepId: "implement~link-1",
        workflowSnapshot: {
          invocationId: "linked-resume-malformed",
          steps: [
            {
              stepId: "implement",
              role: "implement",
              stepRules: "implement rules",
              expectedArtifactPath: "index.md",
              agents: ["claude"],
              agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
            },
          ],
        },
      });
      store.setRunStatus(runId, "paused");

      const run = store.loadRun(runId);
      if (!run) throw new Error("expected paused linked run");
      const reconstructed = reconstructLinkedWorkflowResumeSteps(run);
      expect(reconstructed.ok).toBe(false);
      if (reconstructed.ok) return;
      expect(reconstructed.message).toContain("Pinned linked subspec no longer present in index");
    });

    rmSync(worktreePath, { recursive: true, force: true });
  });

  test("refuses when the row has no workflow snapshot step (guard inversion)", async () => {
    await withStateStore(async (store) => {
      const runId = store.createRun({
        project: "demo",
        specRef: "main",
        worktreePath: "/tmp/no-snapshot",
        branch: "linked-resume/no-snapshot",
        specPath: "index.md",
      });
      store.setRunStatus(runId, "paused");
      const run = store.loadRun(runId);
      if (!run) throw new Error("expected paused run");
      const reconstructed = reconstructLinkedWorkflowResumeSteps(run);
      expect(reconstructed.ok).toBe(false);
    });
  });
});
