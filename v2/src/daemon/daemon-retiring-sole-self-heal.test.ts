import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as ipcClient from "../ipc/client.ts";
import type { RpcHandler } from "../ipc/server.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { mockWriteLoopInput } from "../testing/run-control.ts";
import { DEFAULT_AGENT_MODEL_CONFIG } from "../testing/workflow-step-fixtures.ts";
import { createFakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { shouldShutdownNow } from "./daemon.ts";
import { beginChangeover, startFakeDaemon, uniqueId } from "./daemon-retire-trigger-logging.test-support.ts";
import type { RetiringSoleOwnerSelfHealInput } from "./stable-digest-trigger.ts";

const connectIpcClientSpy = mock(ipcClient.connectIpcClient);
mock.module("../ipc/client.ts", () => ({
  ...ipcClient,
  connectIpcClient: connectIpcClientSpy,
}));

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

function requestFrame(method: string, params?: unknown) {
  return { kind: "request" as const, id: uniqueId(), method, params };
}

function selfHealInput(publicBound = true): RetiringSoleOwnerSelfHealInput {
  return {
    retiring: true,
    publicBound,
    handoffPending: false,
    blocksRollbackReopen: false,
    retireCause: "handoff_origin",
  };
}

function ensureTestMachineConfig(): void {
  const home = process.env.JARVIS_HOME;
  if (home === undefined) throw new Error("JARVIS_HOME unset");
  mkdirSync(join(home, "machines"), { recursive: true });
  writeFileSync(join(home, "config.json"), JSON.stringify({ machineProfile: "test-profile", agents: ["claude"] }));
  writeFileSync(
    join(home, "machines", "test-profile.json"),
    JSON.stringify({ claude: { implement: { rungs: [{ adapterModel: "m", priceKey: "p" }] } } }),
  );
}

function admittedStartInput() {
  return {
    ...mockWriteLoopInput(),
    bindings: [{ id: "claude" }],
    bindingResolution: {
      role: "implement" as const,
      agents: ["claude"],
      agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
    },
  };
}

async function startAdmits(handlers: Record<string, RpcHandler>): Promise<boolean> {
  const response = await handlers.start?.(
    requestFrame("start", { input: admittedStartInput() }),
    new AbortController().signal,
  );
  return response?.kind === "response";
}

async function startSelfHealDaemon(
  store: StateStore,
  socketPath: string,
  extra: {
    predicateInputs?: () => RetiringSoleOwnerSelfHealInput;
    sampleExecutableDigest?: () => Promise<string>;
  } = {},
) {
  const fakeExecutor = createFakeWriteLoopExecutor();
  const privateSocketPath = join(tmpdir(), `jarvis-self-heal-priv-${uniqueId()}.sock`);
  let capturedTick: (() => void) | undefined;
  const jarvisHome = process.env.JARVIS_HOME;
  if (jarvisHome === undefined) throw new Error("JARVIS_HOME unset");
  const { handlers, close: closeDaemon } = await startFakeDaemon(store, socketPath, {
    privateSocketPath,
    enableSelfHandoff: true,
    handoffFallbackMs: 60_000,
    sampleExecutableDigest: extra.sampleExecutableDigest ?? (async () => "loaded-digest"),
    writeLoopExecutor: fakeExecutor.executor,
    hasMemoryHeadroom: () => true,
    writeLoopBindingSourceDeps: {
      forceSnapshotAgentModelConfig: true,
      machineConfigPath: join(jarvisHome, "config.json"),
      machinesDir: join(jarvisHome, "machines"),
    },
    captureSelfHandoffSamplingIntervalTick: (tick) => {
      capturedTick = tick;
    },
    ...(extra.predicateInputs === undefined ? {} : { selfHandoffSelfHealPredicateInputs: extra.predicateInputs }),
  });
  return {
    handlers,
    fireSamplingTick: () => {
      if (capturedTick === undefined) throw new Error("sampling tick was not captured");
      capturedTick();
    },
    close: async () => {
      fakeExecutor.abortAll();
      await closeDaemon();
    },
  };
}

let store: StateStore;
let dbPath: string;
let socketPath: string;

beforeEach(() => {
  ensureTestMachineConfig();
  connectIpcClientSpy.mockClear();
  const unique = uniqueId();
  dbPath = join(tmpdir(), `jarvis-self-heal-${unique}.sqlite`);
  socketPath = join(tmpdir(), `jarvis-self-heal-${unique}.sock`);
  store = openStateStore(dbPath);
});

afterEach(() => {
  store.close();
  rmSync(dbPath, { force: true });
});

test("sampling tick self-heals a stranded handoff-origin sole owner and admits start", async () => {
  const { handlers, fireSamplingTick, close } = await startSelfHealDaemon(store, socketPath, {
    predicateInputs: selfHealInput,
  });
  try {
    await beginChangeover(handlers);
    await flushMicrotasks();
    expect(await startAdmits(handlers)).toBe(false);
    fireSamplingTick();
    expect(await startAdmits(handlers)).toBe(true);
  } finally {
    await close();
  }
});

test("publicBound false leaves admission closed on the sampling tick", async () => {
  const { handlers, fireSamplingTick, close } = await startSelfHealDaemon(store, socketPath, {
    predicateInputs: () => selfHealInput(false),
  });
  try {
    await beginChangeover(handlers);
    await flushMicrotasks();
    fireSamplingTick();
    expect(await startAdmits(handlers)).toBe(false);
  } finally {
    await close();
  }
});

test("self-heal does not run while a handoff is pending and the tick does not probe the public address", async () => {
  let sampleCalls = 0;
  const { handlers, fireSamplingTick, close } = await startSelfHealDaemon(store, socketPath, {
    sampleExecutableDigest: async () => {
      sampleCalls += 1;
      return "loaded-digest";
    },
  });
  try {
    await beginChangeover(handlers);
    expect(await startAdmits(handlers)).toBe(false);
    fireSamplingTick();
    expect(await startAdmits(handlers)).toBe(false);
    expect(sampleCalls).toBe(0);
    expect(connectIpcClientSpy.mock.calls.length).toBe(0);
  } finally {
    await close();
  }
});

test("committed-handoff retire stays retiring across sampling ticks and drains via shouldShutdownNow", async () => {
  const { handlers, fireSamplingTick, close } = await startSelfHealDaemon(store, socketPath, {});
  try {
    const handoffId = await beginChangeover(handlers);
    await flushMicrotasks();
    const commit = await handlers.handoff_commit?.(
      requestFrame("handoff_commit", { handoffId }),
      new AbortController().signal,
    );
    expect(commit?.kind).toBe("response");
    expect(await startAdmits(handlers)).toBe(false);
    fireSamplingTick();
    expect(await startAdmits(handlers)).toBe(false);
    expect(shouldShutdownNow(false, true, false, false)).toBe(true);
  } finally {
    await close();
  }
});

test("operator shutdown exits via shutdownRequested without self-heal reopening admission", async () => {
  const { handlers, fireSamplingTick, close } = await startSelfHealDaemon(store, socketPath, {});
  try {
    await beginChangeover(handlers);
    await flushMicrotasks();
    await handlers.shutdown?.(requestFrame("shutdown"), new AbortController().signal);
    fireSamplingTick();
    expect(await startAdmits(handlers)).toBe(false);
    expect(shouldShutdownNow(true, true, false, false)).toBe(true);
  } finally {
    await close();
  }
});

test("stale handoffId supersede after rollback blocks self-heal on the sampling tick", async () => {
  const { handlers, fireSamplingTick, close } = await startSelfHealDaemon(store, socketPath, {});
  try {
    const handoffId = await beginChangeover(handlers);
    await flushMicrotasks();
    await handlers.handoff_rollback?.(requestFrame("handoff_rollback", { handoffId }), new AbortController().signal);
    await handlers.supersede?.(requestFrame("supersede", { handoffId }), new AbortController().signal);
    expect(await startAdmits(handlers)).toBe(false);
    fireSamplingTick();
    expect(await startAdmits(handlers)).toBe(false);
  } finally {
    await close();
  }
});
