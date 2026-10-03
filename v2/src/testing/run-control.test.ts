import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trackedMkdtempSync } from "../../../shared/tracked-temp-dir.test-support.ts";
import type { WriteWorkflowStep } from "../execution/workflow-runner.ts";
import type { RpcHandler } from "../ipc/server.ts";
import { createHeldWorkflowBindings, workflowWriteStep, withWorkflowStepSeam } from "./run-control.ts";

function freshCwd(): string {
  return trackedMkdtempSync(join(tmpdir(), `held-bindings-${process.pid}-`));
}

async function startHeldInvocation(
  held: ReturnType<typeof createHeldWorkflowBindings>,
  cwd: string,
  signal?: AbortSignal,
) {
  const binding = held.createBinding({ agentId: "claude", adapterModel: "M1", priceKey: "P1" });
  return binding.invoke({ prompt: "p", cwd, ...(signal !== undefined ? { signal } : {}) });
}

test("createHeldWorkflowBindings settleFirst writes proof.txt and resolves ok", async () => {
  const held = createHeldWorkflowBindings();
  const cwd = freshCwd();
  const pending = startHeldInvocation(held, cwd);
  expect(held.pendingCount()).toBe(1);
  held.settleFirst();
  const result = await pending;
  expect(result).toEqual({ kind: "ok", stdout: "done", stderr: "" });
  expect(readFileSync(join(cwd, "proof.txt"), "utf8")).toBe("done\n");
});

test("createHeldWorkflowBindings abortAll resolves error without writing proof.txt", async () => {
  const held = createHeldWorkflowBindings();
  const cwd = freshCwd();
  const pending = startHeldInvocation(held, cwd);
  held.abortAll();
  const result = await pending;
  expect(result).toEqual({ kind: "error", exitCode: 1, stderr: "aborted" });
  expect(existsSync(join(cwd, "proof.txt"))).toBe(false);
});

test("createHeldWorkflowBindings settleAll settles every pending invocation", async () => {
  const held = createHeldWorkflowBindings();
  const cwd1 = freshCwd();
  const cwd2 = freshCwd();
  const pending1 = startHeldInvocation(held, cwd1);
  const pending2 = startHeldInvocation(held, cwd2);
  expect(held.pendingCount()).toBe(2);
  held.settleAll();
  await expect(Promise.all([pending1, pending2])).resolves.toEqual([
    { kind: "ok", stdout: "done", stderr: "" },
    { kind: "ok", stdout: "done", stderr: "" },
  ]);
});

test("withWorkflowStepSeam returns handlers unchanged when start is missing", () => {
  const handlers: Record<string, RpcHandler> = {
    list: async () => ({ kind: "response", result: {} }),
  };
  const seam = (step: WriteWorkflowStep) => step;
  expect(withWorkflowStepSeam(handlers, seam)).toBe(handlers);
});

test("withWorkflowStepSeam applies seam to write steps before start", async () => {
  let admittedStepId: string | undefined;
  const start: RpcHandler = async (frame) => {
    const steps = (frame.params as { steps?: WriteWorkflowStep[] }).steps;
    admittedStepId = steps?.[0]?.stepId;
    return { kind: "response", result: {} };
  };
  const wrapped = withWorkflowStepSeam({ start }, (step) => ({ ...step, stepId: "seamed" }));
  expect(wrapped.start).not.toBe(start);
  await wrapped.start!(
    { kind: "request", id: "s1", method: "start", params: { steps: [workflowWriteStep()] } },
    new AbortController().signal,
  );
  expect(admittedStepId).toBe("seamed");
});

test("createHeldWorkflowBindings abort signal settles as error", async () => {
  const held = createHeldWorkflowBindings();
  const cwd = freshCwd();
  const controller = new AbortController();
  const pending = startHeldInvocation(held, cwd, controller.signal);
  controller.abort();
  const result = await pending;
  expect(result).toEqual({ kind: "error", exitCode: 1, stderr: "aborted" });
  expect(held.isAbortSignalTriggered()).toBe(true);
  expect(existsSync(join(cwd, "proof.txt"))).toBe(false);
});
