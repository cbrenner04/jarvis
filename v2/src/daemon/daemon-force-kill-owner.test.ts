import { expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trackedMkdtempSync } from "../../../shared/tracked-temp-dir.test-support.ts";
import type { IpcClient } from "../ipc/client.ts";
import type { IpcServer, RpcHandler } from "../ipc/server.ts";
import type { IpcFrame } from "../ipc/types.ts";
import { openStateStore } from "../persistence/state-store.ts";
import { flushBackgroundRuns } from "../testing/run-control.ts";
import { DEFAULT_AGENT_MODEL_CONFIG } from "../testing/workflow-step-fixtures.ts";
import { createFakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers, startDaemonRuntime, type WriteLoopBindingSourceDeps } from "./daemon.ts";
import { createStableRunHandlers } from "./daemon-stable-run-routing.ts";

function handlerClient(handler: RpcHandler): IpcClient {
  let resolveFrame: (frame: IpcFrame) => void = () => undefined;
  let rejectFrame: (error: Error) => void = () => undefined;
  let delivered = false;
  const reply = new Promise<IpcFrame>((resolve, reject) => {
    resolveFrame = resolve;
    rejectFrame = reject;
  });
  void reply.catch(() => undefined);
  const closed = new Promise<IpcFrame>((_resolve, reject) => {
    rejectFrame = reject;
  });
  void closed.catch(() => undefined);
  return {
    send(value) {
      const frame = value as Parameters<RpcHandler>[0];
      if (frame.kind !== "request") throw new Error("request expected");
      Promise.resolve(handler(frame, new AbortController().signal)).then(
        (result) => resolveFrame({ ...result, id: frame.id } as IpcFrame),
        rejectFrame,
      );
    },
    nextFrame: () => {
      if (delivered) return closed;
      delivered = true;
      return reply;
    },
    close: () => rejectFrame(new Error("closed")),
  };
}

for (const mode of [
  "direct predecessor",
  "older peer",
  "unreachable owner",
  "wrong peer",
  "without force",
  "production wiring",
] as const) {
  test(`force kill retiring-owner row: ${mode}`, async () => {
    const root = trackedMkdtempSync(join(tmpdir(), "jarvis-force-owner-"));
    const path = join(root, "state.sqlite");
    const ownerStore = openStateStore(path, { currentIdentity: "owner", isOwnerAlive: async () => true });
    const runId = ownerStore.createRun({
      project: "project",
      specRef: "main",
      worktreePath: root,
      branch: "lane",
      specPath: "spec/index.md",
      status: "in-progress",
      stepId: "implement~link-0",
    });
    const owner = createRunControlHandlers({
      stateStore: ownerStore,
      writeLoopExecutor: createFakeWriteLoopExecutor().executor,
      failureReporter: () => undefined,
    });
    owner.setRetiring();
    const successorStore = openStateStore(path, { currentIdentity: "successor", isOwnerAlive: async () => true });
    const successor = createRunControlHandlers({
      stateStore: successorStore,
      writeLoopExecutor: createFakeWriteLoopExecutor().executor,
      failureReporter: () => undefined,
    });
    const wrongStore = openStateStore(path, { currentIdentity: "wrong", isOwnerAlive: async () => true });
    const wrong = createRunControlHandlers({
      stateStore: wrongStore,
      writeLoopExecutor: createFakeWriteLoopExecutor().executor,
      failureReporter: () => undefined,
    });
    const connected: string[] = [];
    const connect = async (socketPath: string): Promise<IpcClient> => {
      connected.push(socketPath);
      if (mode === "unreachable owner") throw new Error("unreachable");
      return handlerClient(mode === "wrong peer" ? wrong.kill : owner.kill);
    };
    const request = {
      kind: "request",
      id: "kill",
      method: "kill",
      params: { runId, ...(mode === "without force" ? {} : { force: true }) },
    } as const;
    let runtime: Awaited<ReturnType<typeof startDaemonRuntime>> | undefined;
    try {
      expect(await successorStore.forceKillOwnerAdmits(runId)).toBe(false);
      expect(owner.hasActiveRuns()).toBe(false);
      let handler: RpcHandler;
      if (mode === "production wiring") {
        let stableKill: RpcHandler | undefined;
        runtime = await startDaemonRuntime(
          "/fake/public.sock",
          successorStore,
          { tail: () => [], async *follow() {} },
          {
            privateSocketPath: "/fake/private.sock",
            enumerateOtherDaemonSockets: () => ["/fake/public.sock", "/fake/private.sock", "/fake/owner.sock"],
            observePredecessorDrain: () => ({ liveRunIds: () => new Set<string>(), stop: () => undefined }),
            connectRunOwnerClient: connect,
            openLogSink: () => ({ append: () => undefined, close: () => undefined }),
            startIpcServer: async (socketPath, handlers = {}) => {
              if (socketPath === "/fake/public.sock") stableKill = handlers.kill;
              return { close: async () => undefined } as IpcServer;
            },
          },
        );
        if (!stableKill) throw new Error("stable kill not registered");
        handler = stableKill;
      } else {
        const routed = createStableRunHandlers(
          { wait: successor.wait, kill: successor.kill },
          {
            ...(mode === "direct predecessor" ? { predecessorSocketPath: "/fake/owner.sock" } : {}),
            discoverPeerSocketPaths: () => ["/fake/owner.sock"],
            ownsRunLocally: () => false,
            resolvePredecessorOwner: async () => false,
            connectOwnerClient: connect,
          },
        );
        handler = routed.kill;
      }
      const response = await handler(request, new AbortController().signal);
      const succeeds = mode === "direct predecessor" || mode === "older peer" || mode === "production wiring";
      expect(response).toMatchObject(
        succeeds
          ? { kind: "response", result: { outcome: "force-settled", status: "killed" } }
          : { kind: "error", code: "run_not_active" },
      );
      expect(successorStore.loadRun(runId)?.status).toBe(succeeds ? "killed" : "in-progress");
      expect(connected).toEqual(mode === "without force" ? [] : ["/fake/owner.sock"]);
    } finally {
      await runtime?.close();
      owner.close();
      successor.close();
      wrong.close();
      ownerStore.close();
      successorStore.close();
      wrongStore.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("force kill routes an active older-peer owner through the normal abort path", async () => {
  const root = trackedMkdtempSync(join(tmpdir(), "jarvis-force-owner-active-"));
  const profileHome = trackedMkdtempSync(join(root, "profile"));
  const machinesDir = join(profileHome, "machines");
  mkdirSync(machinesDir, { recursive: true });
  const rung = (adapterModel: string) => ({ rungs: [{ adapterModel, priceKey: adapterModel }] });
  writeFileSync(
    join(machinesDir, "force-kill.json"),
    JSON.stringify({
      models: {
        codex: {
          implement: rung("codex-fast"),
          plan: rung("plan"),
          shrink: rung("shrink"),
          adversary: rung("a"),
          critic: rung("c"),
          advocate: rung("adv"),
          adjudicator: rung("adj"),
          actuator: rung("act"),
          routing: rung("act"),
        },
        cursor: {
          implement: rung("cursor-fast"),
          plan: rung("plan"),
          shrink: rung("shrink"),
          adversary: rung("a"),
          critic: rung("c"),
          advocate: rung("adv"),
          adjudicator: rung("adj"),
          actuator: rung("act"),
          routing: rung("act"),
        },
      },
    }),
  );
  writeFileSync(
    join(profileHome, "config.json"),
    JSON.stringify({ machineProfile: "force-kill", agents: ["codex", "cursor"] }),
  );
  const previousJarvisHome = process.env.JARVIS_HOME;
  process.env.JARVIS_HOME = profileHome;
  const writeLoopBindingSourceDeps: WriteLoopBindingSourceDeps = {
    machineConfigPath: join(profileHome, "config.json"),
    machinesDir,
  };
  const path = join(root, "state.sqlite");
  const ownerStore = openStateStore(path, { currentIdentity: "owner", isOwnerAlive: async () => true });
  const ownerExecutor = createFakeWriteLoopExecutor();
  const owner = createRunControlHandlers({
    stateStore: ownerStore,
    writeLoopExecutor: ownerExecutor.executor,
    failureReporter: () => undefined,
    hasMemoryHeadroom: () => true,
    writeLoopBindingSourceDeps,
  });
  const successorStore = openStateStore(path, { currentIdentity: "successor", isOwnerAlive: async () => true });
  const successor = createRunControlHandlers({
    stateStore: successorStore,
    writeLoopExecutor: createFakeWriteLoopExecutor().executor,
    failureReporter: () => undefined,
  });
  try {
    const runId = ownerStore.createRun({
      project: "test-project",
      specRef: "main",
      worktreePath: "/tmp/test-project",
      branch: "test-branch",
      specPath: "/tmp/spec.md",
      stepId: "implement",
      status: "paused",
      workflowSnapshot: {
        invocationId: "inv-force-kill",
        steps: [
          {
            stepId: "implement",
            role: "implement",
            stepRules: "rules",
            expectedArtifactPath: "out.md",
            agents: ["codex"],
            agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
          },
        ],
      },
    });
    const resumed = await owner.resume(
      { kind: "request", id: "r", method: "resume", params: { runId } },
      new AbortController().signal,
    );
    if (resumed.kind !== "response") throw new Error("run not started");
    await flushBackgroundRuns();
    owner.setRetiring();
    expect(owner.hasActiveRuns()).toBe(true);
    const routed = createStableRunHandlers(
      { wait: successor.wait, kill: successor.kill },
      {
        discoverPeerSocketPaths: () => ["/fake/owner.sock"],
        ownsRunLocally: () => false,
        resolvePredecessorOwner: async () => false,
        connectOwnerClient: async () => handlerClient(owner.kill),
      },
    );
    const response = await routed.kill(
      { kind: "request", id: "kill", method: "kill", params: { runId, force: true } },
      new AbortController().signal,
    );
    expect(response).toMatchObject({ kind: "response", result: { outcome: "force-settled", status: "killed" } });
    expect(ownerExecutor.isAbortSignalTriggered()).toBe(true);
  } finally {
    if (previousJarvisHome === undefined) delete process.env.JARVIS_HOME;
    else process.env.JARVIS_HOME = previousJarvisHome;
    ownerExecutor.abortAll();
    await flushBackgroundRuns();
    owner.close();
    successor.close();
    ownerStore.close();
    successorStore.close();
    rmSync(root, { recursive: true, force: true });
  }
});
