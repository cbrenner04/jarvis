import { expect, test } from "bun:test";
import type { WriteLoopOutcomeKind } from "../execution/write-loop.ts";
import type { LoopFinishedEvent, PersistedRecord } from "../persistence/log-stream.ts";
import type { Attempt, RunStatus } from "../persistence/state-store.ts";
import type {
  RunOperatorError,
  RunOperatorErrorReason,
  RunOperatorNextAction,
  TerminalLogRecord,
} from "./run-operator-error.ts";
import {
  composeRunOperatorError,
  findTerminalLogRecord,
  isPostBoundaryStateStoreLockTimeout,
  RUN_OPERATOR_ERROR_RECOVERY,
  resolveFailedBlockedAttemptPrecedence,
} from "./run-operator-error.ts";

function runWith(status: RunStatus, attempts: Attempt[] = []): { status: RunStatus; attempts: Attempt[] } {
  return { status, attempts };
}

function attempt(outcomeKind: Attempt["outcomeKind"], detail: Attempt["invocationFailureDetail"] = null): Attempt {
  return {
    id: "attempt-1",
    runId: "run-1",
    attemptNumber: 1,
    startedAt: 1,
    status: "completed",
    outcomeKind,
    completedAt: 2,
    invocationFailureDetail: detail,
  };
}

function loopFinished(
  loopOutcomeKind: WriteLoopOutcomeKind,
  extra: Partial<Extract<TerminalLogRecord["event"], { kind: "loop_finished" }>> = {},
): TerminalLogRecord {
  return {
    runId: "run-1",
    seq: 1,
    ts: "2026-01-01T00:00:00.000Z",
    event: { kind: "loop_finished", loopOutcomeKind, iterationsConsumed: 1, resumable: false, ...extra },
  };
}

function loopFinishedEvent(
  loopOutcomeKind: WriteLoopOutcomeKind,
  extra: Partial<Extract<TerminalLogRecord["event"], { kind: "loop_finished" }>> = {},
): LoopFinishedEvent {
  return loopFinished(loopOutcomeKind, extra).event as LoopFinishedEvent;
}

function runExecutionFailed(seq = 2, message?: string): TerminalLogRecord {
  return {
    runId: "run-1",
    seq,
    ts: "2026-01-01T00:00:00.000Z",
    event: { kind: "run_execution_failed", ...(message !== undefined ? { message } : {}) },
  };
}

function persistedTerminal(seq: number, event: TerminalLogRecord["event"]): PersistedRecord {
  return { runId: "run-1", seq, ts: "2026-01-01T00:00:00.000Z", event };
}

function contractMissDetailRecord(
  seq: number,
  opts: { failureReason?: string; failedContractId?: string } = {},
): PersistedRecord {
  return {
    runId: "run-1",
    seq,
    ts: "2026-01-01T00:00:00.000Z",
    event: {
      kind: "contract_miss_detail",
      attemptId: "attempt-1",
      failedContractId: opts.failedContractId ?? "plan.draft.shape",
      responseText: "agent stdout",
      ...(opts.failureReason !== undefined ? { failureReason: opts.failureReason } : {}),
    },
  };
}

function err(reason: RunOperatorErrorReason, nextAction: RunOperatorNextAction, retryable = false): RunOperatorError {
  return { reason, retryable, nextAction };
}

const resume = (reason: "resumable_pause" | "resumable_budget" | "resumable_kill") => err(reason, "resume", true);

test("composeRunOperatorError returns resumable_pause for loop_finished paused", () => {
  expect(composeRunOperatorError(runWith("paused"), loopFinished("paused"))).toEqual(resume("resumable_pause"));
});

test("composeRunOperatorError returns resumable_pause for store-only paused without terminal log", () => {
  expect(composeRunOperatorError(runWith("paused"))).toEqual(resume("resumable_pause"));
});

test("composeRunOperatorError returns resumable_budget for log budget-exhausted and store-only budget-soft-stopped", () => {
  expect(composeRunOperatorError(runWith("budget-soft-stopped"), loopFinished("budget-exhausted"))).toEqual(
    resume("resumable_budget"),
  );
  expect(composeRunOperatorError(runWith("budget-soft-stopped"))).toEqual(resume("resumable_budget"));
});

test("composeRunOperatorError returns resumable_kill for durable killed without loop_finished", () => {
  expect(composeRunOperatorError(runWith("killed"))).toEqual(resume("resumable_kill"));
});

test("composeRunOperatorError returns resumable_kill when killed and loop_finished progress", () => {
  expect(composeRunOperatorError(runWith("killed"), loopFinished("progress"))).toEqual(resume("resumable_kill"));
});

test("composeRunOperatorError returns agent_blocked and contract_miss from loop_finished", () => {
  expect(composeRunOperatorError(runWith("blocked"), loopFinished("blocked"))).toEqual(
    err("agent_blocked", "inspect_spec"),
  );
  expect(composeRunOperatorError(runWith("failed"), loopFinished("contract_miss"))).toEqual(
    err("contract_miss", "inspect_spec"),
  );
});

test("composeRunOperatorError projects contract_miss_detail.failureReason onto contractMissDetail", () => {
  const failureReason = "plan draft normalizer: broken index link";
  const logRecords: PersistedRecord[] = [
    contractMissDetailRecord(1, { failureReason }),
    persistedTerminal(2, {
      kind: "loop_finished",
      loopOutcomeKind: "contract_miss",
      iterationsConsumed: 1,
      resumable: false,
    }),
  ];
  expect(composeRunOperatorError(runWith("failed"), loopFinished("contract_miss"), logRecords)).toEqual({
    reason: "contract_miss",
    retryable: false,
    nextAction: "inspect_spec",
    contractMissDetail: failureReason,
  });
});

test("composeRunOperatorError omits contractMissDetail when contract_miss_detail lacks failureReason", () => {
  const logRecords: PersistedRecord[] = [
    contractMissDetailRecord(1, { failedContractId: "spec.criteria-ticked" }),
    persistedTerminal(2, {
      kind: "loop_finished",
      loopOutcomeKind: "contract_miss",
      iterationsConsumed: 1,
      resumable: false,
    }),
  ];
  expect(composeRunOperatorError(runWith("failed"), loopFinished("contract_miss"), logRecords)).toEqual(
    err("contract_miss", "inspect_spec"),
  );
});

test("composeRunOperatorError omits contractMissDetail when last contract_miss_detail lacks failureReason", () => {
  const failureReason = "plan draft normalizer: broken index link";
  const logRecords: PersistedRecord[] = [
    contractMissDetailRecord(1, { failureReason }),
    contractMissDetailRecord(2, { failedContractId: "spec.criteria-ticked" }),
    persistedTerminal(3, {
      kind: "loop_finished",
      loopOutcomeKind: "contract_miss",
      iterationsConsumed: 1,
      resumable: false,
    }),
  ];
  expect(composeRunOperatorError(runWith("failed"), loopFinished("contract_miss"), logRecords)).toEqual(
    err("contract_miss", "inspect_spec"),
  );
});

test("composeRunOperatorError projects contractMissDetail from last contract_miss_detail with failureReason", () => {
  const failureReason = "plan draft normalizer: broken index link";
  const logRecords: PersistedRecord[] = [
    contractMissDetailRecord(1, { failedContractId: "spec.criteria-ticked" }),
    contractMissDetailRecord(2, { failureReason }),
    persistedTerminal(3, {
      kind: "loop_finished",
      loopOutcomeKind: "contract_miss",
      iterationsConsumed: 1,
      resumable: false,
    }),
  ];
  expect(composeRunOperatorError(runWith("failed"), loopFinished("contract_miss"), logRecords)).toEqual({
    reason: "contract_miss",
    retryable: false,
    nextAction: "inspect_spec",
    contractMissDetail: failureReason,
  });
});

test("post-commit shrink contract_miss composes to resume", () => {
  expect(
    composeRunOperatorError(
      runWith("paused", [attempt("contract_miss")]),
      loopFinished("contract_miss", { resumable: true }),
    ),
  ).toEqual(err("contract_miss", "resume", true));
  expect(
    composeRunOperatorError(
      runWith("blocked", [attempt("contract_miss")]),
      loopFinished("contract_miss", { resumable: true }),
    ),
  ).toEqual(err("contract_miss", "resume", true));
});

test("composeRunOperatorError maps iteration_timeout as a failed terminal", () => {
  expect(
    composeRunOperatorError(runWith("failed", [attempt("iteration_timeout")]), loopFinished("iteration_timeout")),
  ).toEqual(err("iteration_timeout", "stop"));
});

test("composeRunOperatorError maps resumable iteration_timeout with completion inventory", () => {
  const completedSubspecPaths = ["spec/implement/00-first.md"];
  const remainingSubspecPaths = ["spec/implement/01-second.md"];
  const publicationFailure = { operation: "push" as const, message: "remote rejected", exitCode: 7 };
  expect(
    composeRunOperatorError(
      runWith("failed", [attempt("iteration_timeout")]),
      loopFinished("iteration_timeout", {
        resumable: true,
        completedSubspecPaths,
        remainingSubspecPaths,
        publicationFailure,
      }),
    ),
  ).toEqual({
    reason: "iteration_timeout",
    retryable: true,
    nextAction: "resume",
    completedSubspecPaths,
    remainingSubspecPaths,
    publicationFailure,
  });
});

test("iteration_timeout recovery copy directs resume when terminal row is resumable", () => {
  expect(RUN_OPERATOR_ERROR_RECOVERY.iteration_timeout).toContain("jarvis run resume");
  expect(RUN_OPERATOR_ERROR_RECOVERY.iteration_timeout).not.toEqual(
    "inspect the stall in jarvis run log, then re-dispatch the workflow",
  );
});

test("composeRunOperatorError maps idle_output_timeout as a failed, non-retryable terminal", () => {
  expect(
    composeRunOperatorError(runWith("failed", [attempt("idle_output_timeout")]), loopFinished("idle_output_timeout")),
  ).toEqual(err("idle_output_timeout", "stop"));
});

test("composeRunOperatorError maps idle_output_timeout from attempt detail alone (no matching loop_finished)", () => {
  expect(composeRunOperatorError(runWith("failed", [attempt("idle_output_timeout")]))).toEqual(
    err("idle_output_timeout", "stop"),
  );
});

test("composeRunOperatorError returns agent_blocked and contract_miss from store-only blocked status and outcome_kind", () => {
  expect(composeRunOperatorError(runWith("blocked", [attempt("blocked")]))).toEqual(
    err("agent_blocked", "inspect_spec"),
  );
  expect(composeRunOperatorError(runWith("failed", [attempt("contract_miss")]))).toEqual(
    err("contract_miss", "inspect_spec"),
  );
});

test.each([
  ["quota", "quota_exhausted", "retry_later"],
  ["model_config", "model_config", "fix_config"],
  ["no_binding", "no_binding", "fix_config"],
  ["landing", "landing_failed", "resume"],
  ["error", "invocation_error", "stop"],
  ["timeout", "role_timeout", "retry_later"],
  ["stall", "role_stalled", "retry_later"],
] as const)("composeRunOperatorError maps failureKind %s from log and store-only failed paths", (failureKind, reason, nextAction) => {
  const storeRun = runWith("failed", [attempt("invocation_failure", { failureKind, bindingAttempts: [] })]);
  const retryable = failureKind === "landing" || failureKind === "timeout" || failureKind === "stall";
  const expected = err(reason, nextAction, retryable);

  expect(composeRunOperatorError(storeRun, loopFinished("invocation_failure"))).toEqual(expected);
  expect(composeRunOperatorError(storeRun)).toEqual(expected);
});

test("composeRunOperatorError returns invalid_token from log and store-only last-attempt invalid_token", () => {
  const storeRun = runWith("paused", [attempt("invalid_token")]);
  const expected = err("invalid_token", "resume", true);

  expect(composeRunOperatorError(storeRun, loopFinished("invocation_failure"))).toEqual(expected);
  expect(composeRunOperatorError(storeRun)).toEqual(expected);
});

test("composeRunOperatorError returns missing_blocker from log and store-only last-attempt missing_blocker", () => {
  const storeRun = runWith("paused", [attempt("missing_blocker")]);
  const expected = err("missing_blocker", "resume", true);

  expect(composeRunOperatorError(storeRun, loopFinished("invocation_failure"))).toEqual(expected);
  expect(composeRunOperatorError(storeRun)).toEqual(expected);
  expect(composeRunOperatorError(runWith("paused", [attempt("missing_blocker")]), loopFinished("paused"))).toEqual(
    expected,
  );
});

test("composeRunOperatorError maps exhausted role-timeout to stop/non-retryable, not retry_later", () => {
  const storeRun = runWith("failed", [
    attempt("invocation_failure", { failureKind: "timeout", bindingAttempts: [], exhaustedRoleTimeout: true }),
  ]);
  const expected = err("role_timeout", "stop", false);

  expect(composeRunOperatorError(storeRun, loopFinished("invocation_failure"))).toEqual(expected);
  expect(composeRunOperatorError(storeRun)).toEqual(expected);

  // Inverting the exhausted guard falls back to the non-exhausted retry_later mapping.
  const nonExhaustedRun = runWith("failed", [
    attempt("invocation_failure", { failureKind: "timeout", bindingAttempts: [], exhaustedRoleTimeout: false }),
  ]);
  expect(composeRunOperatorError(nonExhaustedRun)).toEqual(err("role_timeout", "retry_later", true));
});

test("composeRunOperatorError returns invocation_error for legacy detail-free binding-chain invocation_failure", () => {
  const storeRun = runWith("failed", [attempt("invocation_failure", null)]);
  const expected = err("invocation_error", "stop");

  expect(composeRunOperatorError(storeRun, loopFinished("invocation_failure"))).toEqual(expected);
  expect(composeRunOperatorError(storeRun)).toEqual(expected);
});

test("composeRunOperatorError differs for stall vs error failureKind", () => {
  const stallRun = runWith("failed", [attempt("invocation_failure", { failureKind: "stall", bindingAttempts: [] })]);
  const errorRun = runWith("failed", [attempt("invocation_failure", { failureKind: "error", bindingAttempts: [] })]);

  const stallErr = composeRunOperatorError(stallRun);
  const errorErr = composeRunOperatorError(errorRun);

  expect(stallErr?.reason).toBe("role_stalled");
  expect(errorErr?.reason).toBe("invocation_error");
  expect(stallErr?.reason).not.toEqual(errorErr?.reason);
});

test("composeRunOperatorError returns harness_failure for run_execution_failed and failed without mappable attempt detail", () => {
  expect(composeRunOperatorError(runWith("failed"), runExecutionFailed())).toEqual(err("harness_failure", "stop"));
  expect(composeRunOperatorError(runWith("failed"))).toEqual(err("harness_failure", "stop"));
});

test("composeRunOperatorError returns invocation reason for failed with store invocation detail and no terminal log", () => {
  expect(
    composeRunOperatorError(
      runWith("failed", [attempt("invocation_failure", { failureKind: "quota", bindingAttempts: [] })]),
    ),
  ).toEqual(err("quota_exhausted", "retry_later"));
});

test("composeRunOperatorError resolves failed plus loop_finished complete to store attempt detail", () => {
  expect(
    composeRunOperatorError(
      runWith("failed", [attempt("invocation_failure", { failureKind: "model_config", bindingAttempts: [] })]),
      loopFinished("complete"),
    ),
  ).toEqual(err("model_config", "fix_config"));
});

test("composeRunOperatorError never returns an empty failed row when log disagrees with a done boundary", () => {
  // Split-vs-log disagreement (occurrence #8/#9): the run settled `failed` durably, but its own
  // log records `loop_finished complete` and the last committed attempt maps to no resumable
  // reason (`done` isn't a mappable invocation-failure outcome). The row must still name
  // something non-empty rather than silently return undefined.
  const doneAttemptRun = runWith("failed", [attempt("done")]);
  const withLog = composeRunOperatorError(doneAttemptRun, loopFinished("complete"));
  const withoutLog = composeRunOperatorError(doneAttemptRun);
  expect(withLog).toBeDefined();
  expect(withLog?.reason).toBeTruthy();
  expect(withLog?.nextAction).toBeTruthy();
  expect(withoutLog).toBeDefined();
  expect(withoutLog?.reason).toBeTruthy();
  expect(withoutLog?.nextAction).toBeTruthy();
});

test("composeRunOperatorError keeps landing_failed distinct from completion_commit_failed for pending promotion", () => {
  const landingRun = runWith("failed", [
    attempt("invocation_failure", { failureKind: "landing", bindingAttempts: [] }),
  ]);
  const landingError = composeRunOperatorError(landingRun);
  expect(landingError).toEqual(err("landing_failed", "resume", true));

  const commitRun = runWith("failed");
  const commitError = composeRunOperatorError(commitRun, loopFinished("completion_commit_failed", { resumable: true }));
  expect(commitError).toEqual(err("completion_commit_failed", "resume", true));

  expect(landingError?.reason).not.toEqual(commitError?.reason);
});

test("composeRunOperatorError maps exhausted-red terminal evidence as ready_gate_failed without origin on the operator error", () => {
  const event = loopFinished("ready_gate_failed", {
    resumable: true,
    readyGateOrigin: "repair_budget_exhausted",
    readyGateRepairCount: 3,
  });
  const error = composeRunOperatorError(runWith("failed"), event);
  expect(error).toEqual(err("ready_gate_failed", "resume", true));
  expect(error).not.toHaveProperty("readyGateOrigin");
  expect(error).not.toHaveProperty("readyGateRepairCount");
});

test("composeRunOperatorError maps ready_gate_out_of_scope with outside paths and retry-finalization recovery", () => {
  const outsidePath = "v2/src/untouched.test.ts";
  const detail = `ready gate failing paths also reproduce on baseRef: ${outsidePath}`;
  const event = loopFinished("ready_gate_out_of_scope", {
    resumable: true,
    readyGateOutsidePaths: [outsidePath],
    readyGateOutOfScopeDetail: detail,
  });

  expect(composeRunOperatorError(runWith("failed"), event)).toEqual({
    reason: "ready_gate_out_of_scope",
    retryable: true,
    nextAction: "resume",
    readyGateOutsidePaths: [outsidePath],
    readyGateOutOfScopeDetail: detail,
  });
  expect(
    resolveFailedBlockedAttemptPrecedence(
      attempt("blocked"),
      loopFinishedEvent("ready_gate_out_of_scope", {
        resumable: true,
        readyGateOutsidePaths: [outsidePath],
        readyGateOutOfScopeDetail: detail,
      }),
    ),
  ).toEqual({
    reason: "ready_gate_out_of_scope",
    retryable: true,
    nextAction: "resume",
    readyGateOutsidePaths: [outsidePath],
    readyGateOutOfScopeDetail: detail,
  });
});

test("ready_gate_out_of_scope recovery guides retry finalization instead of source repair", () => {
  expect(RUN_OPERATOR_ERROR_RECOVERY.ready_gate_out_of_scope).toContain("retry finalization");
  expect(RUN_OPERATOR_ERROR_RECOVERY.ready_gate_out_of_scope).not.toContain("fix the ready gate failure");
  expect(RUN_OPERATOR_ERROR_RECOVERY.ready_gate_failed).toContain("fix the ready gate failure");
});

test("composeRunOperatorError prefers resumable ready_gate_failed over blocked last attempt", () => {
  expect(
    composeRunOperatorError(
      runWith("failed", [attempt("blocked")]),
      loopFinished("ready_gate_failed", { resumable: true }),
    ),
  ).toEqual(err("ready_gate_failed", "resume", true));
});

test("composeRunOperatorError prefers resumable iteration_timeout over blocked last attempt", () => {
  const completedSubspecPaths = ["spec/implement/00-first.md"];
  const remainingSubspecPaths = ["spec/implement/01-second.md"];
  const publicationFailure = { operation: "push" as const, message: "remote rejected", exitCode: 7 };
  expect(
    composeRunOperatorError(
      runWith("failed", [attempt("blocked")]),
      loopFinished("iteration_timeout", {
        resumable: true,
        completedSubspecPaths,
        remainingSubspecPaths,
        publicationFailure,
      }),
    ),
  ).toEqual({
    reason: "iteration_timeout",
    retryable: true,
    nextAction: "resume",
    completedSubspecPaths,
    remainingSubspecPaths,
    publicationFailure,
  });
  expect(
    composeRunOperatorError(
      runWith("blocked", [attempt("contract_miss")]),
      loopFinished("iteration_timeout", { resumable: true, completedSubspecPaths, remainingSubspecPaths }),
    ),
  ).toEqual({
    reason: "iteration_timeout",
    retryable: true,
    nextAction: "resume",
    completedSubspecPaths,
    remainingSubspecPaths,
  });
});

test("resolveFailedBlockedAttemptPrecedence prefers resumable finalization over blocked attempt", () => {
  const blocked = attempt("blocked");
  expect(
    resolveFailedBlockedAttemptPrecedence(blocked, loopFinishedEvent("ready_gate_failed", { resumable: true })),
  ).toEqual(err("ready_gate_failed", "resume", true));
  expect(resolveFailedBlockedAttemptPrecedence(blocked, loopFinishedEvent("complete"))).toEqual(
    err("agent_blocked", "inspect_spec"),
  );
  expect(
    resolveFailedBlockedAttemptPrecedence(blocked, loopFinishedEvent("ready_gate_failed", { resumable: false })),
  ).toEqual(err("agent_blocked", "inspect_spec"));
});

test("resolveFailedBlockedAttemptPrecedence prefers resumable iteration_timeout over mappable attempt detail", () => {
  const completedSubspecPaths = ["spec/implement/00-first.md"];
  const remainingSubspecPaths = ["spec/implement/01-second.md"];
  const resumableTimeout = loopFinishedEvent("iteration_timeout", {
    resumable: true,
    completedSubspecPaths,
    remainingSubspecPaths,
  });
  expect(resolveFailedBlockedAttemptPrecedence(attempt("blocked"), resumableTimeout)).toEqual({
    reason: "iteration_timeout",
    retryable: true,
    nextAction: "resume",
    completedSubspecPaths,
    remainingSubspecPaths,
  });
  expect(resolveFailedBlockedAttemptPrecedence(attempt("contract_miss"), resumableTimeout)).toEqual({
    reason: "iteration_timeout",
    retryable: true,
    nextAction: "resume",
    completedSubspecPaths,
    remainingSubspecPaths,
  });
  expect(
    resolveFailedBlockedAttemptPrecedence(
      attempt("blocked"),
      loopFinishedEvent("iteration_timeout", { resumable: false }),
    ),
  ).toEqual(err("agent_blocked", "inspect_spec"));
});

test("composeRunOperatorError projects completionCommitError from completion_commit_failed loop_finished", () => {
  const completionCommitError = "failed to push some refs to 'origin/feature'";
  const publicationFailure = {
    operation: "push",
    message: "remote rejected",
    exitCode: 1,
    stderrTail: "error: failed to push some refs",
  } as const;
  const base = { reason: "completion_commit_failed", retryable: true, nextAction: "resume" } as const;
  expect(
    composeRunOperatorError(
      runWith("failed"),
      loopFinished("completion_commit_failed", { resumable: true, completionCommitError, publicationFailure }),
    ),
  ).toEqual({ ...base, completionCommitError, publicationFailure });
  // @mutate v2/src/daemon/run-operator-error.ts "{ completionCommitError: event.completionCommitError }" -> "{}"
  expect(
    composeRunOperatorError(
      runWith("failed"),
      loopFinished("completion_commit_failed", { resumable: true, publicationFailure }),
    ),
  ).toEqual({ ...base, publicationFailure });
});

test("composeRunOperatorError omits completionCommitError for iteration_commit_failed even when terminal row carries it", () => {
  const completionCommitError = "synthetic completion commit message";
  const publicationFailure = {
    operation: "push",
    message: "remote rejected",
    exitCode: 1,
    stderrTail: "error: failed to push some refs",
  } as const;
  expect(
    composeRunOperatorError(
      runWith("failed"),
      loopFinished("iteration_commit_failed", { resumable: true, completionCommitError, publicationFailure }),
    ),
  ).toEqual({ reason: "iteration_commit_failed", retryable: true, nextAction: "resume", publicationFailure });
});

test("composeRunOperatorError maps ready gate, surviving mutation, and flip failures from loop_finished", () => {
  const survivingMutation = {
    survivingMutation: "flip === to !==",
    survivingMutationSourceFile: "src/guard.ts",
    survivingMutationSourceLine: 12,
  } as const;
  expect(composeRunOperatorError(runWith("completed"), loopFinished("ready_gate_failed"))).toEqual(
    err("ready_gate_failed", "resume", true),
  );
  expect(
    composeRunOperatorError(runWith("failed"), loopFinished("iteration_commit_failed", { resumable: true })),
  ).toEqual(err("iteration_commit_failed", "resume", true));
  expect(
    composeRunOperatorError(
      runWith("failed"),
      loopFinished("surviving_mutation_failed", { resumable: true, ...survivingMutation }),
    ),
  ).toEqual({
    reason: "surviving_mutation_failed",
    retryable: true,
    nextAction: "resume",
    ...survivingMutation,
  });
  expect(composeRunOperatorError(runWith("completed"), loopFinished("ready_flip_failed"))).toEqual(
    err("ready_flip_failed", "stop", false),
  );
  expect(composeRunOperatorError(runWith("failed"), loopFinished("mutation_repair_exhausted"))).toEqual(
    err("mutation_repair_exhausted", "inspect_spec", false),
  );
});

test("composeRunOperatorError returns undefined for in-progress and successful completed terminals", () => {
  expect(composeRunOperatorError(runWith("in-progress"))).toBeUndefined();
  expect(composeRunOperatorError(runWith("completed"), loopFinished("complete"))).toBeUndefined();
});

test("findTerminalLogRecord selects chronologically last terminal event", () => {
  const records = [
    persistedTerminal(1, { kind: "loop_finished", loopOutcomeKind: "paused", iterationsConsumed: 1, resumable: true }),
    persistedTerminal(2, { kind: "run_execution_failed" }),
  ];
  expect(findTerminalLogRecord(records)?.event.kind).toBe("run_execution_failed");
});

test("composeRunOperatorError prefers later run_execution_failed over earlier loop_finished on failed resume spawn", () => {
  const records = [
    persistedTerminal(1, {
      kind: "loop_finished",
      loopOutcomeKind: "budget-exhausted",
      iterationsConsumed: 1,
      resumable: true,
    }),
    persistedTerminal(2, { kind: "run_execution_failed" }),
  ];
  expect(composeRunOperatorError(runWith("failed"), findTerminalLogRecord(records))).toEqual(
    err("harness_failure", "stop"),
  );
});

test("composeRunOperatorError does not surface resumable log outcomes when durable status is failed without attempt detail", () => {
  expect(composeRunOperatorError(runWith("failed"), loopFinished("paused"))).toEqual(err("harness_failure", "stop"));
  expect(composeRunOperatorError(runWith("failed"), loopFinished("budget-exhausted"))).toEqual(
    err("harness_failure", "stop"),
  );
});

test("composeRunOperatorError returns harness_failure after budget-soft-stopped demotion with stale budget log", () => {
  expect(composeRunOperatorError(runWith("failed"), loopFinished("budget-exhausted"))).toEqual(
    err("harness_failure", "stop"),
  );
});

test("composeRunOperatorError surfaces run_execution_failed trailing a completed run", () => {
  expect(composeRunOperatorError(runWith("completed"), runExecutionFailed())).toEqual(err("harness_failure", "stop"));
});

test("composeRunOperatorError maps post-boundary database lock to state_store_lock_timeout", () => {
  const run = runWith("failed", [attempt("done")]);
  const terminal = runExecutionFailed(2, "SQLiteError: database is locked");
  expect(composeRunOperatorError(run, terminal)).toEqual(err("state_store_lock_timeout", "resume", true));
  expect(composeRunOperatorError(runWith("completed", [attempt("done")]), terminal)).toEqual(
    err("state_store_lock_timeout", "resume", true),
  );
});

test("composeRunOperatorError keeps harness_failure for message-less run_execution_failed after committed done boundary", () => {
  const terminal = runExecutionFailed(2);
  const expected = err("harness_failure", "stop");
  expect(composeRunOperatorError(runWith("failed", [attempt("done")]), terminal)).toEqual(expected);
  expect(composeRunOperatorError(runWith("completed", [attempt("done")]), terminal)).toEqual(expected);
});

test("composeRunOperatorError keeps harness_failure for lock message without done boundary", () => {
  const terminal = runExecutionFailed(2, "database is locked");
  expect(composeRunOperatorError(runWith("failed"), terminal)).toEqual(err("harness_failure", "stop"));
});

test("post-boundary lock classifier guard inversion", () => {
  const run = runWith("failed", [attempt("done")]);
  const lockTerminal = runExecutionFailed(2, "database is locked");
  const controlTerminal = runExecutionFailed(2, "recordAttemptStart boom");
  const classify = (terminal: TerminalLogRecord) =>
    isPostBoundaryStateStoreLockTimeout(terminal, run)
      ? err("state_store_lock_timeout", "resume", true)
      : err("harness_failure", "stop");
  const inverted = (terminal: TerminalLogRecord) =>
    !isPostBoundaryStateStoreLockTimeout(terminal, run)
      ? err("state_store_lock_timeout", "resume", true)
      : err("harness_failure", "stop");

  expect(classify(lockTerminal)).toEqual(err("state_store_lock_timeout", "resume", true));
  expect(classify(controlTerminal)).toEqual(err("harness_failure", "stop"));
  expect(inverted(lockTerminal)).toEqual(err("harness_failure", "stop"));
  expect(inverted(controlTerminal)).toEqual(err("state_store_lock_timeout", "resume", true));
});
