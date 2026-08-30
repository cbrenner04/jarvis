import { describe, expect, test } from "bun:test";
import type { InvocationFailureDetail } from "../execution/invocation-failure.ts";
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

  test("model_config failure carries its message while no_binding omits it", () => {
    const modelConfig = stageFailureDetailFromEntryRun(
      entryRun({
        status: "failed",
        terminalCause: "invocation_failure",
        terminalFailureDetail: { failureKind: "model_config", message: "unresolved model", bindingAttempts: [] },
      }),
    ) as { reason: string; message?: string };
    expect(modelConfig.reason).toBe("model_config");
    expect(modelConfig.message).toBe("unresolved model");

    const noBinding = stageFailureDetailFromEntryRun(
      entryRun({
        status: "failed",
        terminalCause: "invocation_failure",
        terminalFailureDetail: { failureKind: "no_binding", message: "no binding available", bindingAttempts: [] },
      }),
    ) as { reason: string; message?: string };
    expect(noBinding.reason).toBe("no_binding");
    expect(noBinding).not.toHaveProperty("message");
  });

  const operatorError = (run: NonNullable<ReturnType<StateStore["loadRun"]>>) => {
    const { reason, retryable, nextAction, message } = stageFailureDetailFromEntryRun(run) as {
      reason: string;
      retryable: boolean;
      nextAction: string;
      message?: string;
    };
    return { reason, retryable, nextAction, ...(message !== undefined ? { message } : {}) };
  };

  const invocationFailure = (terminalFailureDetail: InvocationFailureDetail) =>
    entryRun({ status: "failed", terminalCause: "invocation_failure", terminalFailureDetail });

  test("maps each invocation-failure kind to its operator error", () => {
    expect(operatorError(invocationFailure({ failureKind: "quota", bindingAttempts: [] }))).toEqual({
      reason: "quota_exhausted",
      retryable: false,
      nextAction: "retry_later",
    });
    expect(operatorError(invocationFailure({ failureKind: "landing", bindingAttempts: [] }))).toEqual({
      reason: "landing_failed",
      retryable: true,
      nextAction: "resume",
    });
    expect(operatorError(invocationFailure({ failureKind: "error", bindingAttempts: [] }))).toEqual({
      reason: "invocation_error",
      retryable: false,
      nextAction: "stop",
    });
    expect(operatorError(invocationFailure({ failureKind: "error", message: "boom", bindingAttempts: [] }))).toEqual({
      reason: "invocation_error",
      retryable: false,
      nextAction: "stop",
      message: "boom",
    });
  });

  test("non-exhausted timeout/stall are retryable; exhausted timeout stops", () => {
    expect(operatorError(invocationFailure({ failureKind: "timeout", bindingAttempts: [] }))).toEqual({
      reason: "role_timeout",
      retryable: true,
      nextAction: "retry_later",
    });
    expect(operatorError(invocationFailure({ failureKind: "stall", bindingAttempts: [] }))).toEqual({
      reason: "role_stalled",
      retryable: true,
      nextAction: "retry_later",
    });
    expect(
      operatorError(invocationFailure({ failureKind: "timeout", exhaustedRoleTimeout: true, bindingAttempts: [] })),
    ).toEqual({
      reason: "role_timeout",
      retryable: false,
      nextAction: "stop",
    });
  });

  test("maps direct terminal causes without invocation-failure detail", () => {
    expect(operatorError(entryRun({ status: "failed", terminalCause: "blocked" }))).toEqual({
      reason: "agent_blocked",
      retryable: false,
      nextAction: "inspect_spec",
    });
    expect(operatorError(entryRun({ status: "failed", terminalCause: "contract_miss" }))).toEqual({
      reason: "contract_miss",
      retryable: false,
      nextAction: "inspect_spec",
    });
    expect(operatorError(entryRun({ status: "failed", terminalCause: "idle_output_timeout" }))).toEqual({
      reason: "idle_output_timeout",
      retryable: false,
      nextAction: "stop",
    });
  });

  const attempt = (overrides: Partial<Attempt>): Attempt => ({
    id: "attempt",
    runId: "entry-run",
    attemptNumber: 1,
    startedAt: 1,
    status: "completed",
    completedAt: 2,
    outcomeKind: null,
    invocationFailureDetail: null,
    ...overrides,
  });

  test("falls back to the last outcome-bearing attempt when no terminal cause resolves", () => {
    expect(
      operatorError(entryRun({ status: "failed", attempts: [attempt({ outcomeKind: "invalid_token" })] })),
    ).toEqual({ reason: "invalid_token", retryable: true, nextAction: "resume" });
    expect(
      operatorError(entryRun({ status: "failed", attempts: [attempt({ outcomeKind: "missing_blocker" })] })),
    ).toEqual({ reason: "missing_blocker", retryable: true, nextAction: "resume" });
    expect(operatorError(entryRun({ status: "failed", attempts: [attempt({ outcomeKind: "blocked" })] }))).toEqual({
      reason: "agent_blocked",
      retryable: false,
      nextAction: "inspect_spec",
    });
    expect(
      operatorError(entryRun({ status: "failed", attempts: [attempt({ outcomeKind: "contract_miss" })] })),
    ).toEqual({ reason: "contract_miss", retryable: false, nextAction: "inspect_spec" });
    expect(
      operatorError(entryRun({ status: "failed", attempts: [attempt({ outcomeKind: "idle_output_timeout" })] })),
    ).toEqual({ reason: "idle_output_timeout", retryable: false, nextAction: "stop" });
    expect(
      operatorError(
        entryRun({
          status: "failed",
          attempts: [
            attempt({
              outcomeKind: "invocation_failure",
              invocationFailureDetail: { failureKind: "quota", bindingAttempts: [] },
            }),
          ],
        }),
      ),
    ).toEqual({ reason: "quota_exhausted", retryable: false, nextAction: "retry_later" });
  });

  test("uses terminal run status when no cause or attempt outcome resolves", () => {
    expect(operatorError(entryRun({ status: "blocked" }))).toEqual({
      reason: "agent_blocked",
      retryable: false,
      nextAction: "inspect_spec",
    });
    expect(operatorError(entryRun({ status: "killed" }))).toEqual({
      reason: "resumable_kill",
      retryable: true,
      nextAction: "resume",
    });
    expect(operatorError(entryRun({ status: "failed" }))).toEqual({
      reason: "harness_failure",
      retryable: false,
      nextAction: "stop",
    });
  });

  test("projects terminalCause/terminalFailureDetail/attempt detail only when present", () => {
    expect(stageFailureDetailFromEntryRun(entryRun({ status: "killed" }))).toEqual({
      reason: "resumable_kill",
      retryable: true,
      nextAction: "resume",
      entryRunStatus: "killed",
      attempts: [],
    });

    expect(
      stageFailureDetailFromEntryRun(
        entryRun({
          status: "failed",
          terminalCause: "blocked",
          attempts: [attempt({ outcomeKind: "blocked" })],
        }),
      ),
    ).toEqual({
      reason: "agent_blocked",
      retryable: false,
      nextAction: "inspect_spec",
      entryRunStatus: "failed",
      terminalCause: "blocked",
      attempts: [{ attemptNumber: 1, outcomeKind: "blocked" }],
    });

    expect(
      stageFailureDetailFromEntryRun(
        entryRun({
          status: "failed",
          attempts: [
            attempt({
              outcomeKind: "invocation_failure",
              invocationFailureDetail: { failureKind: "error", message: "x", bindingAttempts: [] },
            }),
          ],
        }),
      ),
    ).toEqual({
      reason: "invocation_error",
      retryable: false,
      nextAction: "stop",
      message: "x",
      entryRunStatus: "failed",
      attempts: [
        {
          attemptNumber: 1,
          outcomeKind: "invocation_failure",
          invocationFailureDetail: { failureKind: "error", message: "x", bindingAttempts: [] },
        },
      ],
    });
  });
});
