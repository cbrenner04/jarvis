import { describe, expect, test } from "bun:test";
import { stageArtifactFromEntryRun, stageFailureDetailFromEntryRun } from "./pipeline-stage-settlement.ts";
import type { Attempt, Run, StateStore } from "./state-store.ts";

function entryRun(
  overrides: Partial<Run & { attempts: Attempt[] }> = {},
): NonNullable<ReturnType<StateStore["loadRun"]>> {
  return {
    id: "entry-run",
    project: "project",
    specRef: "main",
    createdAt: 1,
    status: "completed",
    attemptCount: 0,
    worktreePath: "/worktree",
    branch: "branch",
    specPath: "spec.md",
    attempts: [],
    ...overrides,
  };
}

describe("pipeline stage settlement projections", () => {
  test("projects present durable artifact fields and omits absent optional fields", () => {
    expect(stageArtifactFromEntryRun("entry-run", entryRun())).toEqual({
      entryRunId: "entry-run",
      specPath: "spec.md",
    });

    expect(
      stageArtifactFromEntryRun(
        "entry-run",
        entryRun({
          workflowSnapshot: { invocationId: "invocation", steps: [] },
          downstreamInputs: ["one.md"],
          prNumber: 7,
          prUrl: "https://example.test/pull/7",
        }),
        undefined,
        { requestedBase: "main", resolvedBase: "release" },
      ),
    ).toEqual({
      entryRunId: "entry-run",
      invocationId: "invocation",
      specPath: "spec.md",
      downstreamInputs: ["one.md"],
      prNumber: 7,
      prUrl: "https://example.test/pull/7",
      requestedBase: "main",
      resolvedBase: "release",
    });
  });

  test("projects optional durable failure evidence only when present", () => {
    expect(stageFailureDetailFromEntryRun(entryRun({ status: "failed" }))).toEqual({
      reason: "harness_failure",
      retryable: false,
      nextAction: "stop",
      entryRunStatus: "failed",
      attempts: [],
    });

    expect(
      stageFailureDetailFromEntryRun(
        entryRun({
          status: "failed",
          terminalCause: "invocation_failure",
          terminalFailureDetail: { failureKind: "quota", bindingAttempts: [] },
          attempts: [
            {
              id: "attempt",
              runId: "entry-run",
              attemptNumber: 1,
              startedAt: 1,
              status: "completed",
              outcomeKind: "invocation_failure",
              completedAt: 2,
              invocationFailureDetail: { failureKind: "quota", bindingAttempts: [] },
            },
          ],
        }),
      ),
    ).toMatchObject({
      reason: "quota_exhausted",
      retryable: false,
      nextAction: "retry_later",
      terminalCause: "invocation_failure",
      terminalFailureDetail: { failureKind: "quota" },
      attempts: [{ attemptNumber: 1, invocationFailureDetail: { failureKind: "quota" } }],
    });
  });
});
