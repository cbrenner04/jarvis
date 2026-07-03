import { expect } from "bun:test";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import type { IpcClient } from "../ipc/client.ts";

type ListRunsResult = { runs?: DaemonListRunRow[] } | undefined;

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
