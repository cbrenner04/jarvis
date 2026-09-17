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
import { initGitWorkspace } from "./workflow-runner.test-support.ts";
import { reviewMutationWorkflowSnapshot } from "./workflow-runner-resume.test-support.ts";
import { resumeReviewMutationFinalization } from "./workflow-runner-resume.ts";
import { findFirstMarkdownOnlyFenceViolation } from "./write-loop.ts";

describe("executeWorkflow review dispatch", () => {
  describe("review-mutation recovery markdown-only fence", () => {
    const MARKDOWN_OUTPUT_ROOTS = ["ready-intents", ".jarvis-intent-stage"] as const;

    function initReviewMutationMarkdownOnlyFenceWorktree(workspace: string): string {
      mkdirSync(join(workspace, "ready-intents"), { recursive: true });
      mkdirSync(join(workspace, ".jarvis-intent-stage"), { recursive: true });
      mkdirSync(join(workspace, "v2", "src"), { recursive: true });
      writeFileSync(join(workspace, "ready-intents", "seed.md"), "# seed\n", "utf8");
      writeFileSync(join(workspace, ".jarvis-intent-stage", "draft.md"), "# draft\n", "utf8");
      writeFileSync(join(workspace, "v2/src/untouched.test.ts"), "export {}\n", "utf8");
      execFileSync("git", ["add", "-A"], { cwd: workspace });
      execFileSync("git", ["commit", "-qm", "seed"], { cwd: workspace });
      const baseRef = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: workspace,
        encoding: "utf8",
      }).trim();
      writeFileSync(join(workspace, "ready-intents", "seed.md"), "ok\n", "utf8");
      writeFileSync(join(workspace, "v2/src/untouched.test.ts"), "iteration\n", "utf8");
      execFileSync("git", ["add", "-A"], { cwd: workspace });
      execFileSync("git", ["commit", "-qm", "iteration"], { cwd: workspace });
      return baseRef;
    }

    async function seedReviewMutationMarkdownOnlyFenceResume(
      workspace: string,
      store: ReturnType<typeof openStateStore>,
      logsPath: string,
    ) {
      const snapshot = reviewMutationWorkflowSnapshot(
        "review-mutation-markdown-only-fence",
        "implement: markdown-only-fence",
      );
      const branch = "review-mutation/markdown-only-fence";
      const baseRef = initReviewMutationMarkdownOnlyFenceWorktree(workspace);
      const base = {
        project: "demo",
        specRef: baseRef,
        worktreePath: workspace,
        branch,
        specPath: "ready-intents",
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
        allowedPaths: ["ready-intents/seed.md", "v2/src/untouched.test.ts"],
        markdownOnly: true,
        markdownOutputRoots: [...MARKDOWN_OUTPUT_ROOTS],
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

    test("rejected non-markdown path cannot be swept into review-mutation recovery commit or publish", async () => {
      const workspace = initGitWorkspace("review-mutation-markdown-only-fence-");
      const logsPath = join(tmpdir(), `review-mutation-markdown-only-fence-${randomUUID()}.jsonl`);
      try {
        await withStateStore(async (store) => {
          const { run, terminalRecord } = await seedReviewMutationMarkdownOnlyFenceResume(workspace, store, logsPath);
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
          expect(outcome.ok === false ? outcome.message : "").toContain(
            "Ready-gate repair stages path outside markdown workflow output roots:",
          );
          expect(outcome.ok === false ? outcome.message : "").toContain("v2/src/untouched.test.ts");
          expect(commitCalls).toBe(0);
          expect(publishCalls).toBe(0);
          const settledTerminal = findTerminalLogRecord(openLogReader(logsPath).tail(run.id));
          expect(settledTerminal?.event).toMatchObject({
            kind: "loop_finished",
            loopOutcomeKind: "completion_commit_failed",
            resumable: true,
          });
        });
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    });

    test("review-mutation recovery markdown-only fence regression fails when guard is bypassed", async () => {
      const workspace = initGitWorkspace("review-mutation-markdown-only-fence-bypass-");
      const logsPath = join(tmpdir(), `review-mutation-markdown-only-fence-bypass-${randomUUID()}.jsonl`);
      try {
        await withStateStore(async (store) => {
          const { run, terminalRecord, writeRunId } = await seedReviewMutationMarkdownOnlyFenceResume(
            workspace,
            store,
            logsPath,
          );
          const persisted = store.loadRun(writeRunId);
          expect(persisted?.readyGateRepairFence?.markdownOutputRoots).toEqual(
            expect.arrayContaining([...MARKDOWN_OUTPUT_ROOTS]),
          );
          // Mutation checkpoint: remove `.endsWith(".md")` / under-root rejection in
          // `findFirstMarkdownOnlyFenceViolation`.
          const withoutMarkdownFence = findFirstMarkdownOnlyFenceViolation(
            ["v2/src/untouched.test.ts"],
            persisted?.readyGateRepairFence?.markdownOutputRoots ?? [],
          );
          expect(withoutMarkdownFence).toBe("v2/src/untouched.test.ts");

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

    test("review-mutation recovery fails closed when persisted markdown roots are missing on markdown-only run", async () => {
      const workspace = initGitWorkspace("review-mutation-markdown-only-fence-missing-roots-");
      const logsPath = join(tmpdir(), `review-mutation-markdown-only-fence-missing-roots-${randomUUID()}.jsonl`);
      try {
        await withStateStore(async (store) => {
          const { run, terminalRecord, writeRunId } = await seedReviewMutationMarkdownOnlyFenceResume(
            workspace,
            store,
            logsPath,
          );
          const persisted = store.loadRun(writeRunId);
          store.setReadyGateRepairFence(writeRunId, {
            allowedPaths: [...(persisted?.readyGateRepairFence?.allowedPaths ?? [])],
            markdownOnly: true,
            ...(persisted?.readyGateRepairFence?.offendingPath !== undefined
              ? { offendingPath: persisted.readyGateRepairFence.offendingPath }
              : {}),
            outcomeKind: "completion_commit_failed",
          });

          let commitCalls = 0;
          let publishCalls = 0;
          const outcome = await resumeReviewMutationFinalization(run, store, terminalRecord, {
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

          expect(outcome).toMatchObject({ ok: false });
          expect(outcome.ok === false ? outcome.message : "").toContain(
            "Ready-gate repair fence could not reconstruct persisted markdown workflow output roots",
          );
          expect(commitCalls).toBe(0);
          expect(publishCalls).toBe(0);

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
