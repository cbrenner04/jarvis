import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { createRunControlHandlerContext } from "./daemon-run-control-context.ts";

test("reportReviewProgress accumulates multiple steps per invocation", () => {
  const stateStorePath = join(tmpdir(), `jarvis-context-review-${process.pid}-${Date.now()}.db`);
  const stateStore: StateStore = openStateStore(stateStorePath);
  try {
    const ctx = createRunControlHandlerContext({
      stateStore,
      writeLoopExecutor: async () => undefined,
      failureReporter: () => undefined,
    });
    const invocationId = "inv-1";
    ctx.reportReviewProgress(invocationId, "step-a", { status: "in_progress", role: "adversary" });
    ctx.reportReviewProgress(invocationId, "step-b", { status: "in_progress", role: "advocate" });
    const steps = ctx.reviewDebateProgressByInvocation.get(invocationId);
    expect(steps?.get("step-a")).toEqual({ status: "in_progress", role: "adversary" });
    expect(steps?.get("step-b")).toEqual({ status: "in_progress", role: "advocate" });
  } finally {
    stateStore.close();
  }
});

test("createRunControlHandlerContext exposes activeRuns without activeRunForHandler", () => {
  const stateStorePath = join(tmpdir(), `jarvis-context-${process.pid}-${Date.now()}.db`);
  const stateStore: StateStore = openStateStore(stateStorePath);
  try {
    const ctx = createRunControlHandlerContext({
      stateStore,
      writeLoopExecutor: async () => undefined,
      failureReporter: () => undefined,
    });
    expect(ctx.activeRuns).toBeInstanceOf(Map);
    expect(ctx.activeRuns.size).toBe(0);
  } finally {
    stateStore.close();
  }
});
