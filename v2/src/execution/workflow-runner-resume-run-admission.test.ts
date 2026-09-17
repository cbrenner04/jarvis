import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findTerminalLogRecord } from "../daemon/run-operator-error.ts";
import { openLogReader, openLogSink } from "../persistence/log-stream.ts";
import { openStateStore } from "../persistence/state-store.ts";
import { initGitWorkspace } from "./workflow-runner.test-support.ts";
import { reviewMutationWorkflowSnapshot } from "./workflow-runner-resume.test-support.ts";
import { resumeReviewMutationFinalization } from "./workflow-runner-resume.ts";

function readOwnerIdentity(dbPath: string, runId: string): string | null {
  const raw = new Database(dbPath);
  try {
    const row = raw.prepare("SELECT owner_identity AS ownerIdentity FROM runs WHERE id = ?").get(runId) as {
      ownerIdentity: string | null;
    };
    return row.ownerIdentity;
  } finally {
    raw.close();
  }
}

describe("resume run admission", () => {
  test("review-mutation resume refuses when a different owner is still alive, never invoking the completion committer", async () => {
    const PRIOR_IDENTITY = "11111:1000000";
    const CURRENT_IDENTITY = "22222:2000000";
    const workspace = initGitWorkspace("review-mutation-resume-admission-");
    const dbPath = join(tmpdir(), `review-mutation-resume-admission-${randomUUID()}.db`);
    const logsPath = join(workspace, "resume.jsonl");
    try {
      writeFileSync(join(workspace, "spec.md"), "- [ ] work\n", "utf8");
      execFileSync("git", ["add", "-A"], { cwd: workspace });
      execFileSync("git", ["commit", "-qm", "seed"], { cwd: workspace });
      const baseRef = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8" }).trim();

      const priorStore = openStateStore(dbPath, { currentIdentity: PRIOR_IDENTITY });
      const snapshot = reviewMutationWorkflowSnapshot(
        "review-mutation-resume-admission",
        "implement: resume-admission",
      );
      const branch = "review-mutation/resume-admission";
      const base = {
        project: "demo",
        specRef: baseRef,
        worktreePath: workspace,
        branch,
        specPath: "spec.md",
        workflowSnapshot: snapshot,
      };
      const writeRunId = priorStore.createRun({ ...base, stepId: "implement" });
      priorStore.setRunStatus(writeRunId, "completed");
      const writeAttemptId = priorStore.recordAttemptStart(writeRunId);
      priorStore.commitCompletionBoundary({
        attemptId: writeAttemptId,
        runStatus: "completed",
        outcomeKind: "done",
        completionAgent: "codex",
      });
      const reviewRunId = priorStore.createRun({ ...base, stepId: "implement-review" });
      const reviewAttemptId = priorStore.recordAttemptStart(reviewRunId);
      priorStore.commitCompletionBoundary({
        attemptId: reviewAttemptId,
        runStatus: "failed",
        outcomeKind: "invocation_failure",
        invocationFailureDetail: { failureKind: "error", bindingAttempts: [], message: "prior mutation" },
      });
      const seedSink = openLogSink(logsPath);
      seedSink.append(reviewRunId, {
        kind: "loop_finished",
        loopOutcomeKind: "surviving_mutation_failed",
        iterationsConsumed: 0,
        resumable: true,
      });
      seedSink.close();
      priorStore.close();

      // A different, still-live owner: admitRunForResume must refuse before either sub-path
      // (mutation repair or commit-and-publish) invokes the completion committer.
      const store = openStateStore(dbPath, {
        currentIdentity: CURRENT_IDENTITY,
        isOwnerAlive: async (identity) => identity === PRIOR_IDENTITY,
      });
      const run = store.loadRun(reviewRunId);
      if (!run) throw new Error("expected review run");
      const terminalRecord = findTerminalLogRecord(openLogReader(logsPath).tail(reviewRunId));
      const attemptsBefore = run.attempts.length;

      let commitCalls = 0;
      let caught: unknown;
      try {
        await resumeReviewMutationFinalization(run, store, terminalRecord, {
          completionCommitter: async () => {
            commitCalls += 1;
            return { commitSha: "deadbeef", filesChanged: 1 };
          },
          completionPublisher: async () => ({
            pushSha: "deadbeef",
            prNumber: 3,
            prUrl: "https://example.test/pr/3",
          }),
          readyFinalizer: async () => {},
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe(`Run ${reviewRunId} resume admission refused: owner_alive`);
      expect(commitCalls).toBe(0);
      const settled = store.loadRun(reviewRunId);
      expect(settled?.status).toBe("failed");
      expect(readOwnerIdentity(dbPath, reviewRunId)).toBe(PRIOR_IDENTITY);
      expect(settled?.attempts.length).toBe(attemptsBefore);
      store.close();
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(dbPath, { force: true });
    }
  });
});
