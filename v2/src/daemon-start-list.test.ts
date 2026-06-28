import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectIpcClient } from "./ipc/client.ts";
import { type IpcServer, startIpcServer } from "./ipc/server.ts";
import { openStateStore, type StateStore } from "./state-store.ts";
import type { WriteLoopInput } from "./write-loop.ts";
import { WorktreeOwnershipRegistry, type ActiveRun, type OwnershipKey } from "./daemon.ts";
import { getExternalWorktreePath } from "./external-worktree.ts";

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

let stateStore: StateStore;
let server: IpcServer;

beforeEach(async () => {
  if (!canCreateSockets) {
    return;
  }
  rmSync(SOCKET_PATH, { force: true });
  stateStore = openStateStore(join(tmpdir(), `jarvis-state-${process.pid}-${Date.now()}.db`));

  // Set up the in-process daemon handlers
  const _registry = new WorktreeOwnershipRegistry();
  const activeRuns = new Map<string, ActiveRun>();

  const keyString = (key: OwnershipKey): string => `${key.project}:${key.branch}`;

  const startHandler = (frame: any) => {
    const params = frame.params as any;
    if (!params || !params.input) {
      return { kind: "error" as const, code: "invalid_params", message: "Missing input" };
    }

    const input = params.input as WriteLoopInput;
    const key: OwnershipKey = {
      project: input.worktree.projectName,
      branch: input.worktree.branchName,
    };

    if (activeRuns.size > 0) {
      return {
        kind: "error" as const,
        code: "run_in_progress",
        message: "A run is already in progress",
      };
    }

    if (_registry.isClaimed(key)) {
      return {
        kind: "error" as const,
        code: "worktree_claimed",
        message: `Worktree already claimed`,
      };
    }

    const worktreePath = getExternalWorktreePath(input.worktree);
    const runId = stateStore.createRun({
      project: key.project,
      specRef: input.worktree.baseRef,
      worktreePath,
      branch: key.branch,
      specPath: input.specPath,
    });

    const abortController = new AbortController();
    const ks = keyString(key);
    activeRuns.set(ks, { runId, key, abortController });
    _registry.claim(key, { runId, worktreePath });

    // Simulate a quick settlement to test liveness tracking
    setTimeout(() => {
      activeRuns.delete(ks);
      _registry.release(key);
    }, 50);

    return { kind: "response" as const, result: { runId } };
  };

  const listHandler = (frame: any) => {
    const durableRuns = stateStore.listRuns();
    const runList = durableRuns.map((run) => {
      const ks = keyString({ project: run.project, branch: run.branch });
      const isLive = activeRuns.has(ks);
      return {
        runId: run.id,
        project: run.project,
        branch: run.branch,
        status: run.status,
        isLive,
      };
    });
    return { kind: "response" as const, result: { runs: runList } };
  };

  server = await startIpcServer(SOCKET_PATH, {
    start: startHandler,
    list: listHandler,
  });
});

afterEach(async () => {
  if (!canCreateSockets) {
    return;
  }
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
    const result = frame.result as any;
    expect(result).toHaveProperty("runId");
    expect(typeof result.runId).toBe("string");
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

    // Try to start another run while first is active
    const input2 = { ...mockWriteLoopInput(), worktree: { ...mockWriteLoopInput().worktree, projectName: "other-project" } };
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

    // Try to start the same (project, branch) again
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

    // Start a run
    client.send({ kind: "request", id: "s1", method: "start", params: { input } });
    const startResponse = await client.nextFrame();
    expect(startResponse.kind).toBe("response");

    // List runs
    client.send({ kind: "request", id: "l1", method: "list" });
    const listResponse = await client.nextFrame();
    expect(listResponse.kind).toBe("response");
    if (listResponse.kind !== "response") {
      client.close();
      return;
    }

    const result = listResponse.result as any;
    expect(result).toHaveProperty("runs");
    expect(Array.isArray(result.runs)).toBe(true);
    expect(result.runs.length).toBeGreaterThan(0);

    const run = result.runs[0];
    expect(run).toHaveProperty("runId");
    expect(run).toHaveProperty("project");
    expect(run).toHaveProperty("branch");
    expect(run).toHaveProperty("status");
    expect(run).toHaveProperty("isLive");
    expect(run.isLive).toBe(true); // Run is still active
    client.close();
  }),
);

test(
  "settled run is no longer live in list",
  skipIfNoSockets(async () => {
    const client = await connectIpcClient(SOCKET_PATH);
    const input = mockWriteLoopInput();

    // Start a run
    client.send({ kind: "request", id: "s1", method: "start", params: { input } });
    const startResponse = await client.nextFrame();
    expect(startResponse.kind).toBe("response");
    if (startResponse.kind !== "response") {
      client.close();
      return;
    }

    // Wait for settlement (50ms + buffer)
    await new Promise((resolve) => setTimeout(resolve, 150));

    // List runs
    client.send({ kind: "request", id: "l1", method: "list" });
    const listResponse = await client.nextFrame();
    expect(listResponse.kind).toBe("response");
    if (listResponse.kind !== "response") {
      client.close();
      return;
    }

    const result = listResponse.result as any;
    expect(result.runs.length).toBeGreaterThan(0);

    const run = result.runs[0];
    expect(run.isLive).toBe(false); // Run has settled
    client.close();
  }),
);
