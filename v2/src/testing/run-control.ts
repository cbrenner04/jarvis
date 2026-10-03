import { expect } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InvocationResult } from "../../../shared/invocation/execute.ts";
import type { ListRpcParams } from "../commands/run-list-rpc.ts";
import type { createRunControlHandlers } from "../daemon/daemon.ts";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { AnyWorkflowStep, WriteWorkflowStep } from "../execution/workflow-runner.ts";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import type { IpcClient } from "../ipc/client.ts";
import type { RpcHandler } from "../ipc/server.ts";
import type { StateStore } from "../persistence/state-store.ts";
import {
  createBindingFactory,
  DEFAULT_AGENT_MODEL_CONFIG,
  neverResolvingBindingFactory,
} from "./workflow-step-fixtures.ts";
import { createFakeWithExternalWorktree, createJarvisHome } from "./write-fixtures.ts";

/** Yields `times` macrotask turns so background run spawns/settlements land. */
export async function flushBackgroundRuns(times = 1): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

export function loadRunOrThrow(store: StateStore, runId: string): NonNullable<ReturnType<StateStore["loadRun"]>> {
  const run = store.loadRun(runId);
  if (!run) throw new Error(`missing run ${runId}`);
  return run;
}

type SnapshotStep = {
  stepId: string;
  role: string;
  behavior?: "review-debate" | "review";
  durable?: boolean;
};

/** Minimal workflow snapshot for list/retention tests. */
export function workflowSnapshot(
  invocationId: string,
  steps: SnapshotStep[],
  extras: { reviewPasses?: number; reviewBehavior?: "debate" | "light" } = {},
): { invocationId: string; steps: SnapshotStep[]; reviewPasses?: number; reviewBehavior?: "debate" | "light" } {
  return {
    invocationId,
    steps,
    ...(extras.reviewPasses !== undefined ? { reviewPasses: extras.reviewPasses } : {}),
    ...(extras.reviewBehavior !== undefined ? { reviewBehavior: extras.reviewBehavior } : {}),
  };
}

type ListRunsResult = { runs?: DaemonListRunRow[] } | undefined;
type RunControlHandlers = ReturnType<typeof createRunControlHandlers>;

/** Strips the non-RPC methods before passing handlers to `startIpcServer`. */
export function toIpcHandlers(handlers: RunControlHandlers): Record<string, RpcHandler> {
  const {
    reportReviewDebateProgress: _reportReviewDebateProgress,
    clearLiveReviewDebateProgress: _clearLiveReviewDebateProgress,
    wakeNotificationWaiters: _wakeNotificationWaiters,
    close: _close,
    hasActiveRuns: _hasActiveRuns,
    setRetiring: _setRetiring,
    isRetiring: _isRetiring,
    continueContinuablePipelines: _continueContinuablePipelines,
    pipelineExecutionDeps: _pipelineExecutionDeps,
    context: _context,
    ...ipcHandlers
  } = handlers;
  return ipcHandlers;
}

function requestFrame(
  id: string,
  method: string,
  params?: unknown,
): { kind: "request"; id: string; method: string; params?: unknown } {
  return { kind: "request", id, method, params };
}

/** Plain `WriteLoopInput` fixture for executor/resume seams; it is not an admission shape. */
export function mockWriteLoopInput(worktreeOverrides: Partial<WriteLoopInput["worktree"]> = {}): WriteLoopInput {
  return {
    worktree: {
      projectRoot: "/tmp/test-project",
      projectName: "test-project",
      branchName: "test-branch",
      baseRef: "main",
      ...worktreeOverrides,
    },
    specPath: "/tmp/test-project/spec.md",
    stepRules: "test rules",
    expectedArtifactPath: "/tmp/test-project/artifact",
    bindings: [],
  };
}

type HeldInvocation = { signal: AbortSignal | undefined; release: (mode: "settle" | "abort") => void };

/**
 * Write-step bindings that stay live until the test settles or aborts them: the workflow-admission
 * analogue of `createFakeWriteLoopExecutor`. Settling writes the step's `proof.txt` artifact and
 * answers `done`; aborting (explicit or via the step signal) answers an invocation error.
 */
export function createHeldWorkflowBindings() {
  const pending: HeldInvocation[] = [];
  const createBinding = createBindingFactory(
    ({ cwd, signal }) =>
      new Promise<InvocationResult>((resolve) => {
        let released = false;
        const release = (mode: "settle" | "abort"): void => {
          if (released) return;
          released = true;
          if (mode === "settle") {
            writeFileSync(join(cwd, "proof.txt"), "done\n", "utf8");
            resolve({ kind: "ok", stdout: "done", stderr: "" });
            return;
          }
          resolve({ kind: "error", exitCode: 1, stderr: "aborted" });
        };
        pending.push({ signal, release });
        signal?.addEventListener("abort", () => release("abort"), { once: true });
      }),
  );
  const drain = (mode: "settle" | "abort"): void => {
    for (const run of pending.splice(0)) run.release(mode);
  };
  return {
    createBinding,
    settleAll: (): void => drain("settle"),
    abortAll: (): void => drain("abort"),
    settleFirst: (): void => pending.shift()?.release("settle"),
    pendingCount: (): number => pending.length,
    isAbortSignalTriggered: (): boolean => pending.some((run) => run.signal?.aborted === true),
  };
}

export type HeldWorkflowBindings = ReturnType<typeof createHeldWorkflowBindings>;

type WorkflowWriteStepOverrides = Partial<Omit<WriteWorkflowStep, "worktree">> & {
  worktree?: Partial<WriteWorkflowStep["worktree"]>;
};

/**
 * Workflow write step for daemon admission tests: a fresh fake jarvis home with fake
 * materialization, a never-settling binding unless overridden, and no hidden shrink pass.
 */
export function workflowWriteStep(overrides: WorkflowWriteStepOverrides = {}): WriteWorkflowStep {
  const { jarvisRoot } = createJarvisHome();
  const { worktree, ...rest } = overrides;
  return {
    behavior: "write",
    stepId: "step-1",
    role: "implement",
    agents: ["claude"],
    agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
    worktree: {
      projectRoot: "/tmp/test-project",
      projectName: "test-project",
      branchName: "test-branch",
      baseRef: "main",
      jarvisRoot,
      ...worktree,
    },
    specPath: "spec.md",
    stepRules: "Return exactly one terminal token.",
    expectedArtifactPath: "proof.txt",
    createBinding: neverResolvingBindingFactory,
    withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
    suppressShrink: true,
    ...rest,
  };
}

/** Workflow-step admission over IPC; function-valued step fields do not survive JSON, so the server side re-attaches them via {@link withWorkflowStepSeam}. */
export async function startRun(
  client: IpcClient,
  step: WriteWorkflowStep = workflowWriteStep(),
): Promise<string | undefined> {
  client.send({ kind: "request", id: "s1", method: "start", params: { steps: [step] } });
  const frame = await client.nextFrame();
  expect(frame.kind).toBe("response");
  return frame.kind === "response" ? (frame.result as { runId?: string } | undefined)?.runId : undefined;
}

/** Workflow-step admission for in-process handler tests. */
export async function startRunDirect(
  handlers: RunControlHandlers,
  step: WriteWorkflowStep = workflowWriteStep(),
): Promise<string | undefined> {
  const response = await handlers.start(requestFrame("s1", "start", { steps: [step] }), new AbortController().signal);
  expect(response.kind).toBe("response");
  return response.kind === "response" ? (response.result as { runId?: string } | undefined)?.runId : undefined;
}

/** Wraps `start` so every write step that crossed IPC as JSON gets its in-process seams back before admission. */
export function withWorkflowStepSeam(
  handlers: Record<string, RpcHandler>,
  seam: (step: WriteWorkflowStep) => WriteWorkflowStep,
): Record<string, RpcHandler> {
  const start = handlers.start;
  if (start === undefined) return handlers;
  return {
    ...handlers,
    start: (frame, signal) => {
      const params = frame.params as { steps?: AnyWorkflowStep[] } | undefined;
      if (!Array.isArray(params?.steps)) return start(frame, signal);
      const steps = params.steps.map((step) => (step.behavior === "write" ? seam(step) : step));
      return start({ ...frame, params: { ...params, steps } }, signal);
    },
  };
}

/** Seam for {@link withWorkflowStepSeam}: the given bindings plus fake materialization under the step's `jarvisRoot`. */
export function heldWorkflowStepSeam(
  createBinding: NonNullable<WriteWorkflowStep["createBinding"]> = neverResolvingBindingFactory,
): (step: WriteWorkflowStep) => WriteWorkflowStep {
  return (step) => ({
    ...step,
    createBinding,
    withExternalWorktree: createFakeWithExternalWorktree(step.worktree.jarvisRoot),
    suppressShrink: true,
  });
}

export async function listRuns(client: IpcClient): Promise<DaemonListRunRow[] | undefined> {
  client.send({ kind: "request", id: "l1", method: "list" });
  const frame = await client.nextFrame();
  expect(frame.kind).toBe("response");
  return frame.kind === "response" ? (frame.result as ListRunsResult)?.runs : undefined;
}

export async function listRunsDirect(
  handlers: RunControlHandlers,
  params?: ListRpcParams,
): Promise<DaemonListRunRow[] | undefined> {
  const response = await handlers.list(requestFrame("l1", "list", params), new AbortController().signal);
  expect(response.kind).toBe("response");
  return response.kind === "response" ? (response.result as ListRunsResult)?.runs : undefined;
}

/** The owner-local `list_owned` projection served on the private endpoint (see `01-direct-predecessor-ownership-directory.md`). */
export async function listOwnedRunsDirect(handlers: RunControlHandlers): Promise<DaemonListRunRow[] | undefined> {
  const response = await handlers.list_owned(requestFrame("lo1", "list_owned"), new AbortController().signal);
  expect(response.kind).toBe("response");
  return response.kind === "response" ? (response.result as ListRunsResult)?.runs : undefined;
}
