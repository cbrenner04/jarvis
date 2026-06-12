import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateStore, type StateStore } from "./state-store";

const TEST_DB_PATH = join(tmpdir(), "jarvis-test-state.sqlite");

describe("StateStore", () => {
  let store: StateStore;

  beforeEach(() => {
    // Clean up any existing test database
    try {
      rmSync(TEST_DB_PATH, { force: true });
    } catch {
      // Ignore cleanup errors
    }
    store = openStateStore(TEST_DB_PATH);
  });

  afterEach(() => {
    store.close();
    // Clean up test database
    try {
      rmSync(TEST_DB_PATH, { force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("creates a run with correct fields", () => {
    const runId = store.createRun({
      project: "test-project",
      specRef: "main",
      worktreePath: "/tmp/worktree",
      branch: "test-branch",
      specPath: "spec.md",
    });

    expect(runId).toBeTruthy();

    const run = store.loadRun(runId);
    expect(run).toBeTruthy();
    if (!run) throw new Error("Run should exist");
    expect(run.id).toBe(runId);
    expect(run.project).toBe("test-project");
    expect(run.specRef).toBe("main");
    expect(run.worktreePath).toBe("/tmp/worktree");
    expect(run.branch).toBe("test-branch");
    expect(run.specPath).toBe("spec.md");
    expect(run.status).toBe("in-progress");
    expect(run.attemptCount).toBe(0);
    expect(run.createdAt).toBeGreaterThan(0);
    expect(run.attempts).toEqual([]);
  });

  test("migrations are idempotent on re-open", () => {
    // Create a run with the first store instance
    const runId = store.createRun({
      project: "test-project",
      specRef: "main",
      worktreePath: "/tmp/worktree",
      branch: "test-branch",
      specPath: "spec.md",
    });
    store.close();

    // Re-open the store (should apply migrations idempotently)
    store = openStateStore(TEST_DB_PATH);
    const run = store.loadRun(runId);
    expect(run).toBeTruthy();
    if (!run) throw new Error("Run should exist");
    expect(run.project).toBe("test-project");
  });

  test("records attempt start with correct fields", () => {
    const runId = store.createRun({
      project: "test-project",
      specRef: "main",
      worktreePath: "/tmp/worktree",
      branch: "test-branch",
      specPath: "spec.md",
    });

    const attemptId = store.recordAttemptStart(runId);
    expect(attemptId).toBeTruthy();

    const run = store.loadRun(runId);
    if (!run) throw new Error("Run should exist");
    expect(run.attempts).toHaveLength(1);
    const attempt = run.attempts[0];
    if (!attempt) throw new Error("Attempt should exist");
    expect(attempt.id).toBe(attemptId);
    expect(attempt.attemptNumber).toBe(1);
    expect(attempt.status).toBe("in-progress");
    expect(attempt.outcomeKind).toBeNull();
    expect(attempt.startedAt).toBeGreaterThan(0);
  });

  test("commit boundary persists attempt completion and outcome", () => {
    const runId = store.createRun({
      project: "test-project",
      specRef: "main",
      worktreePath: "/tmp/worktree",
      branch: "test-branch",
      specPath: "spec.md",
    });

    const attemptId = store.recordAttemptStart(runId);

    store.commitCompletionBoundary({
      attemptId,
      status: "completed",
      runStatus: "completed",
      outcomeKind: "done",
    });

    const run = store.loadRun(runId);
    if (!run) throw new Error("Run should exist");
    const attempt = run.attempts[0];
    if (!attempt) throw new Error("Attempt should exist");
    expect(attempt.status).toBe("completed");
    expect(attempt.outcomeKind).toBe("done");
    expect(run.status).toBe("completed");
    expect(run.attemptCount).toBe(1);
  });

  test("commit boundary rolls back attempt, outcome, and run checkpoint on mid-boundary failure", () => {
    const runId = store.createRun({
      project: "test-project",
      specRef: "main",
      worktreePath: "/tmp/worktree",
      branch: "test-branch",
      specPath: "spec.md",
    });

    const attemptId = store.recordAttemptStart(runId);

    expect(() =>
      store.commitCompletionBoundary({
        attemptId,
        status: "completed",
        runStatus: "completed",
        outcomeKind: "done",
        beforeRunUpdate: () => {
          throw new Error("forced mid-boundary failure");
        },
      }),
    ).toThrow("forced mid-boundary failure");

    const run = store.loadRun(runId);
    if (!run) throw new Error("Run should exist");
    expect(run.attemptCount).toBe(0);
    expect(run.status).toBe("in-progress");
    const attempt = run.attempts[0];
    if (!attempt) throw new Error("Attempt should exist");
    expect(attempt.status).toBe("in-progress");
    expect(attempt.outcomeKind).toBeNull();
  });

  test("re-committing a finished boundary is idempotent", () => {
    const runId = store.createRun({
      project: "test-project",
      specRef: "main",
      worktreePath: "/tmp/worktree",
      branch: "test-branch",
      specPath: "spec.md",
    });

    const attemptId = store.recordAttemptStart(runId);

    // First commit
    store.commitCompletionBoundary({
      attemptId,
      status: "completed",
      runStatus: "completed",
      outcomeKind: "done",
    });

    let run = store.loadRun(runId);
    if (!run) throw new Error("Run should exist");
    const firstAttemptCount = run.attemptCount;

    // Re-commit the same boundary
    store.commitCompletionBoundary({
      attemptId,
      status: "completed",
      runStatus: "completed",
      outcomeKind: "done",
    });

    run = store.loadRun(runId);
    if (!run) throw new Error("Run should exist");
    // Attempt count should not have advanced again
    expect(run.attemptCount).toBe(firstAttemptCount);
    // Attempt status should still be completed
    const reattempt = run.attempts[0];
    if (!reattempt) throw new Error("Attempt should exist");
    expect(reattempt.status).toBe("completed");
    expect(reattempt.outcomeKind).toBe("done");
  });

  test("multiple attempts on a run are recorded correctly", () => {
    const runId = store.createRun({
      project: "test-project",
      specRef: "main",
      worktreePath: "/tmp/worktree",
      branch: "test-branch",
      specPath: "spec.md",
    });

    const attempt1Id = store.recordAttemptStart(runId);
    store.commitCompletionBoundary({
      attemptId: attempt1Id,
      status: "completed",
      runStatus: "in-progress",
      outcomeKind: "no-work",
    });

    const attempt2Id = store.recordAttemptStart(runId);
    store.commitCompletionBoundary({
      attemptId: attempt2Id,
      status: "completed",
      runStatus: "completed",
      outcomeKind: "done",
    });

    const run = store.loadRun(runId);
    if (!run) throw new Error("Run should exist");
    expect(run.attempts).toHaveLength(2);
    const firstAttempt = run.attempts[0];
    const secondAttempt = run.attempts[1];
    if (!firstAttempt || !secondAttempt) throw new Error("Attempts should exist");
    expect(firstAttempt.attemptNumber).toBe(1);
    expect(secondAttempt.attemptNumber).toBe(2);
    expect(firstAttempt.outcomeKind).toBe("no-work");
    expect(secondAttempt.outcomeKind).toBe("done");
    expect(run.status).toBe("completed");
    expect(run.attemptCount).toBe(2);
  });

  test("uses override path instead of default", () => {
    store.close();

    const customPath = join(tmpdir(), "custom-state-test.sqlite");
    try {
      rmSync(customPath, { force: true });
    } catch {
      // Ignore
    }

    store = openStateStore(customPath);
    const runId = store.createRun({
      project: "test-project",
      specRef: "main",
      worktreePath: "/tmp/worktree",
      branch: "test-branch",
      specPath: "spec.md",
    });

    const run = store.loadRun(runId);
    if (!run) throw new Error("Run should exist");
    expect(run.project).toBe("test-project");

    store.close();
    try {
      rmSync(customPath, { force: true });
    } catch {
      // Ignore
    }
  });

  test("finds the latest run by project and branch even when specRef and worktree differ", () => {
    const olderRunId = store.createRun({
      project: "test-project",
      specRef: "old-ref",
      worktreePath: "/tmp/worktree-a",
      branch: "test-branch",
      specPath: "spec-a.md",
    });
    const newerRunId = store.createRun({
      project: "test-project",
      specRef: "new-ref",
      worktreePath: "/tmp/worktree-b",
      branch: "test-branch",
      specPath: "spec-b.md",
    });
    store.createRun({
      project: "test-project",
      specRef: "other-ref",
      worktreePath: "/tmp/worktree-c",
      branch: "other-branch",
      specPath: "spec-c.md",
    });

    const run = store.findRunByProjectBranch({
      project: "test-project",
      branch: "test-branch",
    });

    expect(run?.id).toBe(newerRunId);
    expect(run?.id).not.toBe(olderRunId);
    expect(run?.specRef).toBe("new-ref");
    expect(run?.worktreePath).toBe("/tmp/worktree-b");
  });
});
