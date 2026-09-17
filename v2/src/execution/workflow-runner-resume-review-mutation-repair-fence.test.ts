import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findTerminalLogRecord } from "../daemon/run-operator-error.ts";
import { openLogReader, openLogSink } from "../persistence/log-stream.ts";
import type { openStateStore } from "../persistence/state-store.ts";
import { withStateStore } from "../testing/write-fixtures.ts";
import { createCompletionCommitter } from "./completion-commit.ts";
import { createCompletionPublisher } from "./completion-publisher.ts";
import { initGitWorkspace } from "./workflow-runner.test-support.ts";
import { reviewMutationWorkflowSnapshot } from "./workflow-runner-resume.test-support.ts";
import { resumeReviewMutationFinalization } from "./workflow-runner-resume.ts";

describe("executeWorkflow review dispatch", () => {
  describe("review-mutation recovery repair fence", () => {
    function initReviewMutationRepairFenceWorktree(workspace: string): string {
      mkdirSync(join(workspace, "v2", "src"), { recursive: true });
      writeFileSync(join(workspace, "spec.md"), "- [ ] work\n", "utf8");
      writeFileSync(join(workspace, "proof.txt"), "ok\n", "utf8");
      writeFileSync(join(workspace, "v2/src/untouched.test.ts"), "export {}\n", "utf8");
      execFileSync("git", ["add", "-A"], { cwd: workspace });
      execFileSync("git", ["commit", "-qm", "seed"], { cwd: workspace });
      const baseRef = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: workspace,
        encoding: "utf8",
      }).trim();
      writeFileSync(join(workspace, "proof.txt"), "done\n", "utf8");
      execFileSync("git", ["add", "proof.txt"], { cwd: workspace });
      execFileSync("git", ["commit", "-qm", "iteration"], { cwd: workspace });
      return baseRef;
    }

    async function seedReviewMutationRepairFenceResume(
      workspace: string,
      store: ReturnType<typeof openStateStore>,
      logsPath: string,
    ) {
      const snapshot = reviewMutationWorkflowSnapshot("review-mutation-repair-fence", "implement: repair-fence");
      const branch = "review-mutation/repair-fence";
      const baseRef = initReviewMutationRepairFenceWorktree(workspace);
      const base = {
        project: "demo",
        specRef: baseRef,
        worktreePath: workspace,
        branch,
        specPath: "spec.md",
        workflowSnapshot: snapshot,
      };
      const writeRunId = store.createRun({ ...base, stepId: "implement" });
      store.setRunStatus(writeRunId, "completed");
      const writeAttemptId = store.recordAttemptStart(writeRunId);
      store.commitCompletionBoundary({
        attemptId: writeAttemptId,
        runStatus: "completed",
        outcomeKind: "done",
        completionAgent: "codex",
      });
      store.setReadyGateRepairFence(writeRunId, {
        allowedPaths: ["proof.txt"],
        offendingPath: "v2/src/untouched.test.ts",
        outcomeKind: "completion_commit_failed",
      });
      const reviewRunId = store.createRun({ ...base, stepId: "implement-review" });
      const reviewAttemptId = store.recordAttemptStart(reviewRunId);
      store.commitCompletionBoundary({
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
      writeFileSync(join(workspace, "v2/src/untouched.test.ts"), "changed\n", "utf8");
      const run = store.loadRun(reviewRunId);
      if (!run) throw new Error("expected review run");
      const terminalRecord = findTerminalLogRecord(openLogReader(logsPath).tail(reviewRunId));
      return { run, terminalRecord, writeRunId, reviewRunId };
    }

    test("rejected repair path cannot be swept into review-mutation recovery commit or publish", async () => {
      const workspace = initGitWorkspace("review-mutation-repair-fence-");
      const logsPath = join(tmpdir(), `review-mutation-repair-fence-${randomUUID()}.jsonl`);
      try {
        await withStateStore(async (store) => {
          const { run, terminalRecord } = await seedReviewMutationRepairFenceResume(workspace, store, logsPath);
          let commitCalls = 0;
          let publishCalls = 0;
          const logSink = openLogSink(logsPath);
          const outcome = await resumeReviewMutationFinalization(run, store, terminalRecord, {
            logSink,
            completionCommitter: async () => {
              commitCalls += 1;
              return { commitSha: "deadbeef", filesChanged: 1 };
            },
            completionPublisher: async () => {
              publishCalls += 1;
              return { pushSha: "deadbeef", prNumber: 3, prUrl: "https://example.test/pr/3" };
            },
            readyFinalizer: async () => {},
          });
          logSink.close();

          expect(outcome).toMatchObject({ ok: false });
          expect(outcome.ok === false ? outcome.message : "").toContain("v2/src/untouched.test.ts");
          expect(commitCalls).toBe(0);
          expect(publishCalls).toBe(0);
          const settledTerminal = findTerminalLogRecord(openLogReader(logsPath).tail(run.id));
          expect(settledTerminal?.event).toMatchObject({
            kind: "loop_finished",
            loopOutcomeKind: "completion_commit_failed",
            resumable: true,
            completionCommitError: outcome.ok === false ? outcome.message : undefined,
          });
        });
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    });

    test("review-mutation-resume publication push failure logs the same completionCommitError as the resume outcome", async () => {
      const workspace = initGitWorkspace("review-mutation-resume-pub-fail-");
      const logsPath = join(workspace, "resume.jsonl");
      try {
        writeFileSync(join(workspace, "spec.md"), "# Spec\n\n## Acceptance criteria\n\n- [x] complete\n", "utf8");
        execFileSync("git", ["add", "spec.md"], { cwd: workspace });
        execFileSync("git", ["commit", "-qm", "base"], { cwd: workspace });
        const baseRef = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8" }).trim();
        execFileSync("git", ["branch", "-M", "main"], { cwd: workspace });

        await withStateStore(async (store) => {
          const snapshot = reviewMutationWorkflowSnapshot("review-mutation-pub-fail", "implement: pub-fail");
          const base = {
            project: "demo",
            specRef: baseRef,
            worktreePath: workspace,
            branch: "review-mutation/pub-fail",
            specPath: "spec.md",
            workflowSnapshot: snapshot,
          };
          const writeRunId = store.createRun({ ...base, stepId: "implement" });
          store.setRunStatus(writeRunId, "completed");
          const writeAttemptId = store.recordAttemptStart(writeRunId);
          store.commitCompletionBoundary({
            attemptId: writeAttemptId,
            runStatus: "completed",
            outcomeKind: "done",
            completionAgent: "codex",
          });

          const reviewRunId = store.createRun({ ...base, stepId: "implement-review" });
          const reviewAttemptId = store.recordAttemptStart(reviewRunId);
          store.commitCompletionBoundary({
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

          const run = store.loadRun(reviewRunId);
          if (!run) throw new Error("expected review run");
          const terminalRecord = findTerminalLogRecord(openLogReader(logsPath).tail(reviewRunId));
          const logSink = openLogSink(logsPath);
          const failingGit = async (_cwd: string, args: readonly string[]) => {
            if (args[0] === "push") throw new Error("failed to push some refs to origin");
            return "";
          };
          const outcome = await resumeReviewMutationFinalization(run, store, terminalRecord, {
            logSink,
            completionCommitter: createCompletionCommitter(),
            completionPublisher: createCompletionPublisher({ git: failingGit }),
            readyFinalizer: async () => {},
          });
          logSink.close();

          expect(outcome).toMatchObject({ ok: false });
          expect(outcome.ok === false ? outcome.message : "").toContain("failed to push");
          const settledTerminal = findTerminalLogRecord(openLogReader(logsPath).tail(reviewRunId));
          expect(settledTerminal?.event).toMatchObject({
            kind: "loop_finished",
            loopOutcomeKind: "completion_commit_failed",
            completionCommitError: outcome.ok === false ? outcome.message : undefined,
          });
        });
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    });

    test("review-mutation recovery fence regression fails when guard is bypassed", async () => {
      const workspace = initGitWorkspace("review-mutation-repair-fence-bypass-");
      const logsPath = join(tmpdir(), `review-mutation-repair-fence-bypass-${randomUUID()}.jsonl`);
      try {
        await withStateStore(async (store) => {
          const { run, terminalRecord } = await seedReviewMutationRepairFenceResume(workspace, store, logsPath);

          let fencedCommitCalls = 0;
          const fenced = await resumeReviewMutationFinalization(run, store, terminalRecord, {
            completionCommitter: async () => {
              fencedCommitCalls += 1;
              return { commitSha: "deadbeef", filesChanged: 1 };
            },
            completionPublisher: async () => ({ pushSha: "deadbeef", prNumber: 3, prUrl: "https://example.test/pr/3" }),
            readyFinalizer: async () => {},
          });
          expect(fenced).toMatchObject({ ok: false });
          expect(fencedCommitCalls).toBe(0);

          let bypassedCommitCalls = 0;
          const bypassed = await resumeReviewMutationFinalization(run, store, terminalRecord, {
            completionCommitter: async () => {
              bypassedCommitCalls += 1;
              return { commitSha: "deadbeef", filesChanged: 1 };
            },
            completionPublisher: async () => ({ pushSha: "deadbeef", prNumber: 3, prUrl: "https://example.test/pr/3" }),
            readyFinalizer: async () => {},
            persistedRepairFenceEnforcer: async () => undefined,
          });
          expect(bypassed).toMatchObject({ ok: true });
          expect(bypassedCommitCalls).toBeGreaterThan(0);
        });
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    });
  });
});
