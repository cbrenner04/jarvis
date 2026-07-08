import { expect } from "bun:test";
import type { createRunControlHandlers } from "../daemon/daemon.ts";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import type { IpcClient } from "../ipc/client.ts";
import type { RpcHandler } from "../ipc/server.ts";

type ListRunsResult = { runs?: DaemonListRunRow[] } | undefined;
type RunControlHandlers = ReturnType<typeof createRunControlHandlers>;

/** Strips non-RPC helpers before passing handlers to `startIpcServer`. */
export function toIpcHandlers(handlers: RunControlHandlers): Record<string, RpcHandler> {
  const { reportReviewDebateProgress: _reportReviewDebateProgress, close: _close, ...ipcHandlers } = handlers;
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

export async function listRunsDirect(handlers: RunControlHandlers): Promise<DaemonListRunRow[] | undefined> {
  const response = await handlers.list(requestFrame("l1", "list"), new AbortController().signal);
  expect(response.kind).toBe("response");
  return response.kind === "response" ? (response.result as ListRunsResult)?.runs : undefined;
}
