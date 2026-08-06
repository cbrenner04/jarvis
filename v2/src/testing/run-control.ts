import { expect } from "bun:test";
import type { ListRpcParams } from "../commands/run-list-rpc.ts";
import type { createRunControlHandlers } from "../daemon/daemon.ts";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import type { IpcClient } from "../ipc/client.ts";
import type { RpcHandler } from "../ipc/server.ts";
import type { StateStore } from "../persistence/state-store.ts";

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
    close: _close,
    hasActiveRuns: _hasActiveRuns,
    setRetiring: _setRetiring,
    isRetiring: _isRetiring,
    continueContinuablePipelines: _continueContinuablePipelines,
    pipelineExecutionDeps: _pipelineExecutionDeps,
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

export async function startRun(client: IpcClient, input = mockWriteLoopInput()): Promise<string | undefined> {
  client.send({ kind: "request", id: "s1", method: "start", params: { input } });
  const frame = await client.nextFrame();
  expect(frame.kind).toBe("response");
  return frame.kind === "response" ? (frame.result as { runId?: string } | undefined)?.runId : undefined;
}

export async function listRuns(client: IpcClient): Promise<DaemonListRunRow[] | undefined> {
  client.send({ kind: "request", id: "l1", method: "list" });
  const frame = await client.nextFrame();
  expect(frame.kind).toBe("response");
  return frame.kind === "response" ? (frame.result as ListRunsResult)?.runs : undefined;
}

export async function startRunDirect(
  handlers: RunControlHandlers,
  input = mockWriteLoopInput(),
): Promise<string | undefined> {
  const response = await handlers.start(requestFrame("s1", "start", { input }), new AbortController().signal);
  expect(response.kind).toBe("response");
  return response.kind === "response" ? (response.result as { runId?: string } | undefined)?.runId : undefined;
}

export async function listRunsDirect(
  handlers: RunControlHandlers,
  params?: ListRpcParams,
): Promise<DaemonListRunRow[] | undefined> {
  const response = await handlers.list(requestFrame("l1", "list", params), new AbortController().signal);
  expect(response.kind).toBe("response");
  return response.kind === "response" ? (response.result as ListRunsResult)?.runs : undefined;
}
