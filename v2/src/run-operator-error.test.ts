import { expect, test } from "bun:test";
import type {
  RunOperatorError,
  RunOperatorErrorReason,
  RunOperatorNextAction,
  TerminalLogRecord,
} from "./run-operator-error.ts";
import { composeRunOperatorError } from "./run-operator-error.ts";
import type { Attempt } from "./state-store.ts";
import type { RunStatus } from "./state-store-types.ts";
import type { WriteLoopOutcomeKind } from "./write-loop.ts";

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
    invocationFailureDetail: detail,
  };
}

function loopFinished(loopOutcomeKind: WriteLoopOutcomeKind): TerminalLogRecord {
  return {
    runId: "run-1",
    seq: 1,
    ts: "2026-01-01T00:00:00.000Z",
    event: { kind: "loop_finished", loopOutcomeKind, iterationsConsumed: 1, resumable: false },
  };
}

function runExecutionFailed(): TerminalLogRecord {
  return {
    runId: "run-1",
    seq: 1,
    ts: "2026-01-01T00:00:00.000Z",
    event: { kind: "run_execution_failed" },
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
  ["error", "invocation_error", "stop"],
] as const)("composeRunOperatorError maps failureKind %s from log and store-only failed paths", (failureKind, reason, nextAction) => {
  const storeRun = runWith("failed", [attempt("invocation_failure", { failureKind, bindingAttempts: [] })]);
  const expected = err(reason, nextAction);

  expect(composeRunOperatorError(storeRun, loopFinished("invocation_failure"))).toEqual(expected);
  expect(composeRunOperatorError(storeRun)).toEqual(expected);
});

test("composeRunOperatorError returns invalid_token from log and store-only last-attempt invalid_token", () => {
  const storeRun = runWith("failed", [attempt("invalid_token")]);
  const expected = err("invalid_token", "stop");

  expect(composeRunOperatorError(storeRun, loopFinished("invocation_failure"))).toEqual(expected);
  expect(composeRunOperatorError(storeRun)).toEqual(expected);
});

test("composeRunOperatorError returns invocation_error for legacy detail-free binding-chain invocation_failure", () => {
  const storeRun = runWith("failed", [attempt("invocation_failure", null)]);
  const expected = err("invocation_error", "stop");

  expect(composeRunOperatorError(storeRun, loopFinished("invocation_failure"))).toEqual(expected);
  expect(composeRunOperatorError(storeRun)).toEqual(expected);
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

test("composeRunOperatorError returns undefined for in-progress and successful completed terminals", () => {
  expect(composeRunOperatorError(runWith("in-progress"))).toBeUndefined();
  expect(composeRunOperatorError(runWith("completed"), loopFinished("complete"))).toBeUndefined();
});
