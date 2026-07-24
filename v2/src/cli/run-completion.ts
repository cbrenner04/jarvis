import type { WaitRunCompletionResult } from "../daemon/daemon.ts";
import { parseWaitCompletion } from "../daemon/daemon-wire.ts";
import type { executeWriteLoop } from "../execution/write-loop.ts";
import type { IpcClient } from "../ipc/client.ts";
import { RpcError } from "../ipc/rpc-errors.ts";
import type { Io } from "./io.ts";
import { formatRpcError, request } from "./ipc.ts";

function buildWaitPayload(result: WaitRunCompletionResult): Record<string, unknown> {
  const payload: Record<string, unknown> = { runStatus: result.runStatus };
  if (result.loopOutcomeKind !== undefined) payload.loopOutcomeKind = result.loopOutcomeKind;
  if (result.iterationsConsumed !== undefined) payload.iterationsConsumed = result.iterationsConsumed;
  if (result.resumable !== undefined) payload.resumable = result.resumable;
  if (result.error !== undefined) payload.error = result.error;
  if (result.worktreePath !== undefined) payload.worktreePath = result.worktreePath;
  return payload;
}

export function exitCodeForWriteResult(kind: Awaited<ReturnType<typeof executeWriteLoop>>["kind"]): number {
  if (kind === "complete") return 0;
  if (
    kind === "completion_commit_failed" ||
    kind === "iteration_commit_failed" ||
    kind === "ready_gate_failed" ||
    kind === "ready_flip_failed"
  ) {
    return 1;
  }
  if (kind === "invocation_failure") return 2;
  if (kind === "budget-exhausted") return 5;
  return 1;
}

export function exitCodeForWaitResult(result: WaitRunCompletionResult): number {
  if (result.loopOutcomeKind !== undefined) {
    return exitCodeForWriteResult(result.loopOutcomeKind);
  }

  switch (result.runStatus) {
    case "failed":
      return 3;
    case "killed":
      return 4;
    case "budget-soft-stopped":
      return 5;
    default:
      return 1;
  }
}

export async function waitForRunCompletion(client: IpcClient, runId: string, io: Io): Promise<number> {
  let response: unknown;
  try {
    response = await request(client, "wait", { runId });
  } catch (error) {
    if (error instanceof RpcError) {
      io.stderr(formatRpcError(error));
      return 1;
    }
    throw error;
  }
  const result = parseWaitCompletion(response);
  if (result === undefined) {
    io.stderr("invalid daemon response\n");
    return 1;
  }
  io.stdout(`${JSON.stringify(buildWaitPayload(result))}\n`);
  return exitCodeForWaitResult(result);
}
