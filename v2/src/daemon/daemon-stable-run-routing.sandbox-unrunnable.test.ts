import { afterEach, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { connectIpcClient } from "../ipc/client.ts";
import { createRpcTransport } from "../ipc/rpc-transport.ts";
import { type IpcServer, type RpcHandler, startIpcServer } from "../ipc/server.ts";
import { createStablePipelineListHandler, createStableRunHandlers } from "./daemon-stable-run-routing.ts";
import { resolvePipelineIdAcrossDaemons } from "./pipeline-daemon-resolution.ts";

const servers: IpcServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function socketPath(label: string): string {
  const scratch = join(process.cwd(), ".scratch");
  mkdirSync(scratch, { recursive: true });
  return join(scratch, `${label}-${process.pid}-${crypto.randomUUID()}.sock`);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const unused: RpcHandler = () => ({ kind: "error", code: "unused", message: "unused" });

async function bindForwardingPair(ownerHandlers: Record<"wait" | "pause" | "kill", RpcHandler>) {
  const ownerPath = socketPath("run-owner");
  const stablePath = socketPath("stable-daemon");
  const owner = await startIpcServer(ownerPath, ownerHandlers);
  servers.push(owner);
  const localRefusal: RpcHandler = () => ({ kind: "error", code: "run_not_active", message: "local refusal" });
  const stableHandlers = createStableRunHandlers(
    { wait: localRefusal, pause: localRefusal, kill: localRefusal },
    {
      predecessorSocketPath: ownerPath,
      ownsRunLocally: () => false,
      resolvePredecessorOwner: async () => true,
      connectOwnerClient: connectIpcClient,
    },
  );
  const stable = await startIpcServer(stablePath, stableHandlers);
  servers.push(stable);
  const client = await connectIpcClient(stablePath);
  return { client, transport: createRpcTransport(client) };
}

test("stable-address wait remains pending until the direct predecessor settles it", async () => {
  const ownerSettlement = deferred<{ runStatus: string; loopOutcomeKind: string }>();
  let ownerWaitStarted = false;
  const wait: RpcHandler = async () => {
    ownerWaitStarted = true;
    return { kind: "response", result: await ownerSettlement.promise };
  };
  const { transport } = await bindForwardingPair({ wait, pause: unused, kill: unused });
  let settled = false;
  const pending = transport.request("wait", { runId: "draining-run" }).finally(() => {
    settled = true;
  });

  // Yield a macrotask per check: a microtask-only spin starves socket I/O and never reaches the owner.
  while (!ownerWaitStarted) await Bun.sleep(1);
  expect(settled).toBe(false);
  ownerSettlement.resolve({ runStatus: "completed", loopOutcomeKind: "complete" });
  expect(await pending).toEqual({ runStatus: "completed", loopOutcomeKind: "complete" });
  transport.close();
});

test("stable-address kill preserves force and aborts the direct predecessor invocation", async () => {
  const invocation = new AbortController();
  let receivedParams: unknown;
  const kill: RpcHandler = (request) => {
    receivedParams = request.params;
    invocation.abort();
    return {
      kind: "response",
      result: { ok: true, outcome: "force-settled", runId: "draining-run", status: "killed", survivors: [] },
    };
  };
  const { transport } = await bindForwardingPair({ wait: unused, pause: unused, kill });

  expect(await transport.request("kill", { runId: "draining-run", force: true })).toEqual({
    ok: true,
    outcome: "force-settled",
    runId: "draining-run",
    status: "killed",
    survivors: [],
  });
  expect(receivedParams).toEqual({ runId: "draining-run", force: true });
  expect(invocation.signal.aborted).toBe(true);
  transport.close();
});

test("prefix resolution succeeds over a real stable socket whose predecessor has exited", async () => {
  const pipelineId = "d28c8d6e-4dff-4ea0-af76-ce8c829e5516";
  const snapshot = {
    pipelineId,
    name: "full-review",
    state: "running",
    terminalPublicationSucceededAt: null,
    terminalPublicationFailure: null,
    createdAt: 1,
    finishedAtMs: null,
    dismissedAt: null,
    stages: [],
  };
  const stablePath = socketPath("stable-daemon");
  const stable = await startIpcServer(stablePath, {
    pipeline_list: createStablePipelineListHandler(() => ({ kind: "response", result: { pipelines: [snapshot] } }), {
      predecessorSocketPath: socketPath("exited-predecessor"),
      connectOwnerClient: connectIpcClient,
    }),
  });
  servers.push(stable);

  expect(
    await resolvePipelineIdAcrossDaemons(pipelineId.slice(0, 8), { socketPath: stablePath, connectIpcClient }),
  ).toEqual({ kind: "resolved", pipelineId });
});
