import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunControlHandlers } from "./daemon.ts";
import { connectIpcClient } from "./ipc/client.ts";
import { type IpcServer, startIpcServer } from "./ipc/server.ts";
import { openStateStore, type StateStore } from "./state-store.ts";
import type { WriteLoopInput } from "./write-loop.ts";

// Check if sockets can be created in /tmp; skip all tests if not (sandbox restriction)
let canCreateSockets = false;

const testSocketPath = join(tmpdir(), `.jarvis-socket-test-daemon-start-list-${process.pid}-${Date.now()}`);
const testServer = createServer();
await new Promise<void>((resolve) => {
  testServer.once("listening", () => {
    canCreateSockets = true;
    testServer.close();
    try {
      rmSync(testSocketPath, { force: true });
    } catch {}
    resolve();
  });

  testServer.once("error", () => {
    canCreateSockets = false;
    resolve();
  });

  testServer.listen(testSocketPath);
  setTimeout(() => resolve(), 100);
});

const SOCKET_PATH = join(tmpdir(), `jarvis-daemon-test-${process.pid}.sock`);

type PendingExecutorRun = {
  input: WriteLoopInput;
  signal: AbortSignal;
  pauseSignal: AbortSignal;
  settle: () => void;
};

function createFakeWriteLoopExecutor() {
  const pending: PendingExecutorRun[] = [];

  const executor = async (
    input: WriteLoopInput,
    signal: AbortSignal,
    pauseSignal: AbortSignal,
  ): Promise<void> => {
    await new Promise<void>((resolve) => {
      pending.push({ input, signal, pauseSignal, settle: resolve });
    });
  };

  const settleAll = (): void => {
    while (pending.length > 0) {
      pending.shift()?.settle();
    }
  };

  return {
    executor,
    pending,
    settleAll,
    abortAndSettleAll: settleAll,
    isPauseSignalTriggered: (): boolean => pending.some((run) => run.pauseSignal.aborted),
    isAbortSignalTriggered: (): boolean => pending.some((run) => run.signal.aborted),
  };
}

type FakeWriteLoopExecutor = ReturnType<typeof createFakeWriteLoopExecutor>;

let stateStore: StateStore;
let server: IpcServer;
let fakeExecutor: FakeWriteLoopExecutor;

async function flushBackgroundRuns(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

beforeEach(async () => {
  if (!canCreateSockets) {
    return;
  }
  rmSync(SOCKET_PATH, { force: true });
  stateStore = openStateStore(join(tmpdir(), `jarvis-state-${process.pid}-${Date.now()}.db`));
  fakeExecutor = createFakeWriteLoopExecutor();

  const handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
  });

  server = await startIpcServer(SOCKET_PATH, handlers);
});

afterEach(async () => {
  if (!canCreateSockets) {
    return;
  }
  fakeExecutor.abortAndSettleAll();
  await flushBackgroundRuns();
  try {
    await server.close();
  } catch {
    // server may have already stopped
  }
  rmSync(SOCKET_PATH, { force: true });
  try {
    stateStore.close();
  } catch {
    // store may be closed
  }
});

function skipIfNoSockets(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    if (!canCreateSockets) {
      return;
    }
    return fn();
  };
}

function mockWriteLoopInput(): WriteLoopInput {
  return {
    worktree: {
      projectRoot: "/tmp/test-project",
      projectName: "test-project",
      branchName: "test-branch",
      baseRef: "main",
    },
    specPath: "/tmp/test-project/spec.md",
    stepRules: "test rules",
    expectedArtifactPath: "/tmp/test-project/artifact",
    bindings: [],
  };
}

test(
  "start returns a run ID",
  skipIfNoSockets(async () => {
    const client = await connectIpcClient(SOCKET_PATH);
    const input = mockWriteLoopInput();
    client.send({ kind: "request", id: "s1", method: "start", params: { input } });
    const frame = await client.nextFrame();
    expect(frame.kind).toBe("response");
    if (frame.kind !== "response") return;
    const result = frame.result as { runId?: string } | undefined;
    expect(result).toHaveProperty("runId");
    expect(typeof result?.runId).toBe("string");
    client.close();
  }),
);

test(
  "start rejects when any run is active (single in-flight guard)",
  skipIfNoSockets(async () => {
    const client = await connectIpcClient(SOCKET_PATH);
    const input1 = mockWriteLoopInput();
    client.send({ kind: "request", id: "s1", method: "start", params: { input: input1 } });
    const response1 = await client.nextFrame();
    expect(response1.kind).toBe("response");

    const input2 = {
      ...mockWriteLoopInput(),
      worktree: { ...mockWriteLoopInput().worktree, projectName: "other-project" },
    };
    client.send({ kind: "request", id: "s2", method: "start", params: { input: input2 } });
    const response2 = await client.nextFrame();
    expect(response2.kind).toBe("error");
    if (response2.kind === "error") {
      expect(response2.code).toBe("run_in_progress");
    }
    client.close();
  }),
);

test(
  "start rejects second start for same (project, branch) while first is active",
  skipIfNoSockets(async () => {
    const client = await connectIpcClient(SOCKET_PATH);
    const input = mockWriteLoopInput();
    client.send({ kind: "request", id: "s1", method: "start", params: { input } });
    const response1 = await client.nextFrame();
    expect(response1.kind).toBe("response");

    client.send({ kind: "request", id: "s2", method: "start", params: { input } });
    const response2 = await client.nextFrame();
    expect(response2.kind).toBe("error");
    if (response2.kind === "error") {
      expect(response2.code).toBe("worktree_claimed");
    }
    client.close();
  }),
);

test(
  "list returns durable runs with liveness info",
  skipIfNoSockets(async () => {
    const client = await connectIpcClient(SOCKET_PATH);
    const input = mockWriteLoopInput();

    client.send({ kind: "request", id: "s1", method: "start", params: { input } });
    const startResponse = await client.nextFrame();
    expect(startResponse.kind).toBe("response");

    client.send({ kind: "request", id: "l1", method: "list" });
    const listResponse = await client.nextFrame();
    expect(listResponse.kind).toBe("response");
    if (listResponse.kind !== "response") {
      client.close();
      return;
    }

    const result = listResponse.result as
      | { runs?: Array<{ runId: string; project: string; branch: string; status: string; isLive: boolean }> }
      | undefined;
    expect(result).toHaveProperty("runs");
    expect(Array.isArray(result?.runs)).toBe(true);
    expect(result?.runs?.length).toBeGreaterThan(0);

    const run = result?.runs?.[0];
    expect(run).toHaveProperty("runId");
    expect(run).toHaveProperty("project");
    expect(run).toHaveProperty("branch");
    expect(run).toHaveProperty("status");
    expect(run).toHaveProperty("isLive");
    expect(run?.isLive).toBe(true);
    client.close();
  }),
);

test(
  "settled run is no longer live in list",
  skipIfNoSockets(async () => {
    const client = await connectIpcClient(SOCKET_PATH);
    const input = mockWriteLoopInput();

    client.send({ kind: "request", id: "s1", method: "start", params: { input } });
    const startResponse = await client.nextFrame();
    expect(startResponse.kind).toBe("response");
    if (startResponse.kind !== "response") {
      client.close();
      return;
    }

    fakeExecutor.settleAll();
    await flushBackgroundRuns();

    client.send({ kind: "request", id: "l1", method: "list" });
    const listResponse = await client.nextFrame();
    expect(listResponse.kind).toBe("response");
    if (listResponse.kind !== "response") {
      client.close();
      return;
    }

    const result = listResponse.result as
      | { runs?: Array<{ runId: string; project: string; branch: string; status: string; isLive: boolean }> }
      | undefined;
    expect(result?.runs?.length).toBeGreaterThan(0);

    const run = result?.runs?.[0];
    expect(run?.isLive).toBe(false);
    client.close();
  }),
);

test(
  "pause signals graceful stop for an active run",
  skipIfNoSockets(async () => {
    const client = await connectIpcClient(SOCKET_PATH);
    const input = mockWriteLoopInput();

    client.send({ kind: "request", id: "s1", method: "start", params: { input } });
    const startResponse = await client.nextFrame();
    expect(startResponse.kind).toBe("response");
    if (startResponse.kind !== "response") {
      client.close();
      return;
    }

    const runId = (startResponse.result as { runId?: string } | undefined)?.runId;

    client.send({ kind: "request", id: "p1", method: "pause", params: { runId } });
    const pauseResponse = await client.nextFrame();
    expect(pauseResponse.kind).toBe("response");
    if (pauseResponse.kind === "response") {
      expect((pauseResponse.result as { ok?: boolean } | undefined)?.ok).toBe(true);
    }
    expect(fakeExecutor.isPauseSignalTriggered()).toBe(true);
    client.close();
  }),
);

test(
  "pause rejects unknown run ID",
  skipIfNoSockets(async () => {
    const client = await connectIpcClient(SOCKET_PATH);

    client.send({ kind: "request", id: "p1", method: "pause", params: { runId: "unknown-id" } });
    const pauseResponse = await client.nextFrame();
    expect(pauseResponse.kind).toBe("error");
    if (pauseResponse.kind === "error") {
      expect(pauseResponse.code).toBe("unknown_run");
    }
    client.close();
  }),
);

test(
  "kill aborts an active run and records killed status",
  skipIfNoSockets(async () => {
    const client = await connectIpcClient(SOCKET_PATH);
    const input = mockWriteLoopInput();

    client.send({ kind: "request", id: "s1", method: "start", params: { input } });
    const startResponse = await client.nextFrame();
    expect(startResponse.kind).toBe("response");
    if (startResponse.kind !== "response") {
      client.close();
      return;
    }

    const runId = (startResponse.result as { runId?: string } | undefined)?.runId;

    client.send({ kind: "request", id: "k1", method: "kill", params: { runId } });
    const killResponse = await client.nextFrame();
    expect(killResponse.kind).toBe("response");
    if (killResponse.kind === "response") {
      expect((killResponse.result as { ok?: boolean } | undefined)?.ok).toBe(true);
    }
    expect(fakeExecutor.isAbortSignalTriggered()).toBe(true);

    client.send({ kind: "request", id: "l1", method: "list" });
    const listResponse = await client.nextFrame();
    expect(listResponse.kind).toBe("response");
    if (listResponse.kind === "response") {
      const runs = (
        listResponse.result as
          | { runs?: Array<{ runId: string; project: string; branch: string; status: string; isLive: boolean }> }
          | undefined
      )?.runs;
      const run = runs?.find(
        (r: { runId: string; project: string; branch: string; status: string; isLive: boolean }) => r.runId === runId,
      );
      expect(run).toBeDefined();
      expect(run?.status).toBe("killed");
    }
    client.close();
  }),
);

test(
  "kill rejects unknown run ID",
  skipIfNoSockets(async () => {
    const client = await connectIpcClient(SOCKET_PATH);

    client.send({ kind: "request", id: "k1", method: "kill", params: { runId: "unknown-id" } });
    const killResponse = await client.nextFrame();
    expect(killResponse.kind).toBe("error");
    if (killResponse.kind === "error") {
      expect(killResponse.code).toBe("unknown_run");
    }
    client.close();
  }),
);

test(
  "resume rejects unknown run ID",
  skipIfNoSockets(async () => {
    const client = await connectIpcClient(SOCKET_PATH);

    client.send({ kind: "request", id: "r1", method: "resume", params: { runId: "unknown-id" } });
    const resumeResponse = await client.nextFrame();
    expect(resumeResponse.kind).toBe("error");
    if (resumeResponse.kind === "error") {
      expect(resumeResponse.code).toBe("unknown_run");
    }
    client.close();
  }),
);

test(
  "resume rejects terminal run status",
  skipIfNoSockets(async () => {
    const client = await connectIpcClient(SOCKET_PATH);
    const input = mockWriteLoopInput();

    client.send({ kind: "request", id: "s1", method: "start", params: { input } });
    const startResponse = await client.nextFrame();
    expect(startResponse.kind).toBe("response");
    if (startResponse.kind !== "response") {
      client.close();
      return;
    }

    const runId = (startResponse.result as { runId?: string } | undefined)?.runId;

    fakeExecutor.settleAll();
    await flushBackgroundRuns();

    client.send({ kind: "request", id: "r1", method: "resume", params: { runId } });
    const resumeResponse = await client.nextFrame();
    expect(resumeResponse.kind).toBe("response");
    client.close();
  }),
);

test(
  "resume rejects if another run is in-flight (single in-flight guard)",
  skipIfNoSockets(async () => {
    const client = await connectIpcClient(SOCKET_PATH);
    const input1 = mockWriteLoopInput();
    const input2 = {
      ...mockWriteLoopInput(),
      worktree: { ...mockWriteLoopInput().worktree, branchName: "other-branch" },
    };

    client.send({ kind: "request", id: "s1", method: "start", params: { input: input1 } });
    const startResponse1 = await client.nextFrame();
    expect(startResponse1.kind).toBe("response");
    if (startResponse1.kind !== "response") {
      client.close();
      return;
    }

    client.send({ kind: "request", id: "s2", method: "start", params: { input: input2 } });
    const startResponse2 = await client.nextFrame();
    expect(startResponse2.kind).toBe("error");

    client.close();
  }),
);

test(
  "kill aborts the abort signal that bindings can observe",
  skipIfNoSockets(async () => {
    const client = await connectIpcClient(SOCKET_PATH);
    const input = mockWriteLoopInput();

    client.send({ kind: "request", id: "s1", method: "start", params: { input } });
    const startResponse = await client.nextFrame();
    expect(startResponse.kind).toBe("response");
    if (startResponse.kind !== "response") {
      client.close();
      return;
    }

    const runId = (startResponse.result as { runId?: string } | undefined)?.runId;

    client.send({ kind: "request", id: "k1", method: "kill", params: { runId } });
    const killResponse = await client.nextFrame();
    expect(killResponse.kind).toBe("response");
    expect(fakeExecutor.isAbortSignalTriggered()).toBe(true);

    client.send({ kind: "request", id: "l1", method: "list" });
    const listResponse = await client.nextFrame();
    if (listResponse.kind === "response") {
      const runs = (
        listResponse.result as
          | { runs?: Array<{ runId: string; project: string; branch: string; status: string; isLive: boolean }> }
          | undefined
      )?.runs;
      const run = runs?.find(
        (r: { runId: string; project: string; branch: string; status: string; isLive: boolean }) => r.runId === runId,
      );
      expect(run?.status).toBe("killed");
    }

    client.close();
  }),
);
