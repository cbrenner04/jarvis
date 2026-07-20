import { expect, test } from "bun:test";
import type { Attempt, Run } from "../persistence/state-store.ts";
import { stoppedOutcomeForRun } from "./workflow-list-snapshot.ts";

function runFixture(
  status: Run["status"],
  attempts: Array<Pick<Attempt, "outcomeKind">> = [],
): Run & { attempts: Attempt[] } {
  return {
    id: "run-1",
    project: "wf-outcomes",
    specRef: "main",
    createdAt: 0,
    status,
    attemptCount: attempts.length,
    worktreePath: "/tmp/wf-outcomes",
    branch: "wf-outcomes",
    specPath: "/tmp/spec.md",
    attempts: attempts.map((attempt, index) => ({
      id: `attempt-${index}`,
      runId: "run-1",
      attemptNumber: index + 1,
      startedAt: 0,
      status: "completed",
      outcomeKind: attempt.outcomeKind,
      invocationFailureDetail: null,
    })),
  };
}

test.each([
  ["blocked with a contract_miss attempt", runFixture("blocked", [{ outcomeKind: "contract_miss" }]), "contract_miss"],
  ["blocked without a contract_miss attempt", runFixture("blocked", [{ outcomeKind: "blocked" }]), "blocked"],
  ["budget-soft-stopped", runFixture("budget-soft-stopped"), "budget-exhausted"],
  ["paused", runFixture("paused"), "paused"],
  ["killed", runFixture("killed"), "killed"],
  ["any other status (failed)", runFixture("failed"), "invocation_failure"],
] as const)("stoppedOutcomeForRun maps %s", (_name, run, expected) => {
  expect(stoppedOutcomeForRun(run)).toBe(expected);
});
